import type { RunnerEvent } from './generated/RunnerEvent'
import type { RunnerFileEvent } from './generated/RunnerFileEvent'
import {
  filterFileReport,
  filterOutput,
  filterRetainedReport,
} from './output-fields'

type Delta = Extract<RunnerEvent, { type: 'assistant.delta' }>
interface OutputContext {
  text: string
  secrets: readonly string[]
}
export interface HeldOutput {
  event: Delta
  secrets: readonly string[]
  contexts?: readonly OutputContext[]
}
const REDACTION_MARKER = '[redacted]'

/** Holds only the suffix that can still become a known credential. */
export class OutputSanitizer {
  private readonly secrets = new Set<string>()
  private readonly pending = new Map<string, HeldOutput>()

  constructor(pending: readonly HeldOutput[] = []) {
    for (const held of pending) this.pending.set(this.key(held.event), held)
  }

  snapshot(): HeldOutput[] {
    return [...this.pending.values()]
  }

  add(secret: string): void {
    if (secret) this.secrets.add(secret)
  }

  text(value: string): string {
    return this.filter(value, true).text
  }

  fileReport(event: RunnerFileEvent): RunnerFileEvent {
    return filterFileReport(event, (value) => this.text(value))
  }

  retainedReport(event: RetainedReport): RetainedReport {
    return filterRetainedReport(event, (value) => this.text(value))
  }

  accept(event: RunnerEvent): RunnerEvent[] {
    if (event.type === 'assistant.delta') return this.delta(event, false)
    const result: RunnerEvent[] = []
    if (event.type === 'assistant.completed') {
      result.push(...this.flush((held) => this.key(held) === this.key(event)))
      const previous = this.pending.get(this.key(event))
      const secrets = this.values(previous)
      const text = this.filter(event.text, true, secrets).text
      this.retain(
        { ...event, type: 'assistant.delta', text: '' },
        secrets,
        this.contexts(
          [...(previous?.contexts ?? []).map((context) => context.text), text],
          secrets,
        ),
      )
      return [...result, { ...event, text }]
    }
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      result.push(
        ...this.flush(
          (held) =>
            held.sessionId === event.sessionId && held.turnId === event.turnId,
        ),
      )
    }
    result.push(this.clean(event))
    return result
  }

  private delta(event: Delta, final: boolean): RunnerEvent[] {
    const previous = this.pending.get(this.key(event))
    const secrets = this.values(previous)
    const text = (previous?.event.text ?? '') + event.text
    const filtered = this.filter(
      text,
      final,
      secrets,
      this.continuations(previous?.contexts ?? []),
    )
    const contexts = this.contexts(
      [
        ...(previous?.contexts ?? []).map(
          (context) => context.text + filtered.text,
        ),
        filtered.text,
      ],
      secrets,
    )
    this.retain({ ...event, text: filtered.held }, secrets, contexts)
    return filtered.text ? [{ ...event, text: filtered.text }] : []
  }

  private values(held: HeldOutput | undefined): string[] {
    return [
      ...new Set([
        ...this.secrets,
        ...(held?.secrets ?? []),
        ...(held?.contexts ?? []).flatMap((context) => context.secrets),
      ]),
    ]
  }

  private contexts(texts: readonly string[], secrets: readonly string[]) {
    const contexts = new Map<string, OutputContext>()
    for (const text of texts) {
      const suffix = this.filter(text, false, secrets).held
      if (suffix)
        contexts.set(suffix, {
          text: suffix,
          secrets: secrets.filter(
            (secret) => this.filter(suffix, false, [secret]).held,
          ),
        })
    }
    return [...contexts.values()]
  }

  private continuations(contexts: readonly OutputContext[]): string[] {
    const values = new Set<string>()
    for (const context of contexts) {
      for (let index = 0; index < context.text.length; index++) {
        const prefix = context.text.slice(index)
        for (const secret of context.secrets)
          if (secret.length > prefix.length && secret.startsWith(prefix))
            values.add(secret.slice(prefix.length))
      }
    }
    return [...values]
  }

  private retain(
    event: Delta,
    secrets: readonly string[],
    contexts: readonly OutputContext[],
  ) {
    const key = this.key(event)
    if (event.text || contexts.length)
      this.pending.set(key, {
        event,
        secrets: secrets.filter(
          (secret) => this.filter(event.text, false, [secret]).held,
        ),
        ...(contexts.length ? { contexts } : {}),
      })
    else this.pending.delete(key)
  }

  private key(event: {
    sessionId: string
    turnId: string
    messageId: string
  }): string {
    return JSON.stringify([event.sessionId, event.turnId, event.messageId])
  }

  private flush(matches: (event: Delta) => boolean): RunnerEvent[] {
    const result: RunnerEvent[] = []
    for (const held of this.pending.values()) {
      const { event } = held
      if (!event.text || !matches(event)) continue
      result.push(...this.delta({ ...event, text: '' }, true))
    }
    return result
  }

  private filter(
    text: string,
    final: boolean,
    values: readonly string[] = [...this.secrets],
    continuations: readonly string[] = [],
  ): { text: string; held: string } {
    const secrets = [...values].sort((a, b) => b.length - a.length)
    const initial = [...secrets, ...continuations].sort(
      (a, b) => b.length - a.length,
    )
    let output = ''
    let index = 0
    while (index < text.length) {
      const candidates = index === 0 ? initial : secrets
      const rest = text.slice(index)
      if (
        !final &&
        candidates.some(
          (secret) => secret.length > rest.length && secret.startsWith(rest),
        )
      )
        return { text: output, held: rest }
      const secret = candidates.find((secret) => text.startsWith(secret, index))
      if (
        text.startsWith(REDACTION_MARKER, index) &&
        (!secret || secret.length <= REDACTION_MARKER.length)
      ) {
        output += REDACTION_MARKER
        index += REDACTION_MARKER.length
      } else if (secret) {
        output += REDACTION_MARKER
        index += secret.length
      } else output += text[index++]
    }
    return { text: output, held: '' }
  }

  private clean(event: RunnerEvent): RunnerEvent {
    return filterOutput(event, (value) => this.text(value))
  }
}
type RetainedReport = Extract<
  RunnerEvent,
  { type: 'start.updated' | 'workspace.title' }
>
