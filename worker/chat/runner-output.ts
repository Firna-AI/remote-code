import type { RunnerEventEnvelope } from '../../src/shared/generated/RunnerEventEnvelope'
import { boundChatEvent } from '../../src/shared/event-limits'
import {
  OutputSanitizer,
  type HeldOutput,
} from '../../src/shared/output-sanitizer'
import type { AppEnv } from '../env'
import { runningOutputSecrets } from '../lifecycle/output-secrets'
import { decrypt, encrypt } from '../security/crypto'
import { array, parseAgentEvent } from './agent-events'
import { record, string, strings } from './inputs'
import type { ChatTransaction } from './store'
import type { RunnerWorkspaceRecord } from './types'
import { displayPortReport } from './port-reports'

export interface FilteredRunnerOutput {
  events: RunnerEventEnvelope[]
  save(): Promise<void>
}

function parseHeld(value: unknown): HeldOutput[] {
  if (!Array.isArray(value)) throw new Error('Invalid output filter state')
  return value.map((entry: unknown) => {
    const input = record(entry)
    const event = parseAgentEvent(input.event)
    if (event.type !== 'assistant.delta') throw new Error('Invalid held output')
    return {
      event,
      secrets: strings(input.secrets).map(string),
      ...(input.contexts === undefined
        ? {}
        : {
            contexts: array(input.contexts, (value) => {
              const context = record(value)
              return {
                text: string(context.text),
                secrets: strings(context.secrets).map(string),
              }
            }),
          }),
    }
  })
}

function unreleased(snapshot: readonly HeldOutput[]): HeldOutput[] {
  return snapshot.flatMap(({ event, secrets }) =>
    event.text ? [{ event, secrets }] : [],
  )
}

function released(snapshot: readonly HeldOutput[]): HeldOutput[] {
  return snapshot.flatMap(({ event, contexts }) =>
    contexts?.length
      ? [{ event: { ...event, text: '' }, secrets: [], contexts }]
      : [],
  )
}

function combine(snapshot: readonly HeldOutput[]): HeldOutput[] {
  const answers = new Map<string, HeldOutput>()
  for (const held of snapshot) {
    const { event } = held
    const key = JSON.stringify([event.sessionId, event.turnId, event.messageId])
    const previous = answers.get(key)
    const contexts = new Map<
      string,
      NonNullable<HeldOutput['contexts']>[number]
    >()
    for (const context of [
      ...(previous?.contexts ?? []),
      ...(held.contexts ?? []),
    ]) {
      contexts.set(context.text, {
        text: context.text,
        secrets: [
          ...new Set([
            ...(contexts.get(context.text)?.secrets ?? []),
            ...context.secrets,
          ]),
        ],
      })
    }
    answers.set(key, {
      event: previous?.event ?? event,
      secrets: [...new Set([...(previous?.secrets ?? []), ...held.secrets])],
      contexts: [...contexts.values()],
    })
  }
  return [...answers.values()]
}

/** Restore per-receipt state so a failed transaction cannot consume held text. */
export async function filterRunnerOutput(
  env: AppEnv,
  transaction: ChatTransaction,
  workspace: RunnerWorkspaceRecord,
  input: RunnerEventEnvelope,
): Promise<FilteredRunnerOutput> {
  const streamContext = (streamId: string) =>
    JSON.stringify(['runner-output', workspace.id, streamId])
  const context = JSON.stringify(['runner-output-context', workspace.id])
  const readStream = async (streamId: string) => {
    const saved = await transaction.output.read(streamId)
    return saved
      ? parseHeld(
          JSON.parse(
            await decrypt(
              saved,
              streamContext(streamId),
              env.BOAT_KEY_ENCRYPTION_KEY,
            ),
          ),
        )
      : []
  }
  const pending = await readStream(input.streamId)
  const saved = await transaction.output.readContexts()
  const contexts = saved
    ? parseHeld(
        JSON.parse(await decrypt(saved, context, env.BOAT_KEY_ENCRYPTION_KEY)),
      )
    : []
  const legacy: { streamId: string; snapshot: HeldOutput[] }[] = []
  if (!saved) {
    for (const streamId of await transaction.output.streams()) {
      if (streamId === input.streamId) continue
      const snapshot = await readStream(streamId)
      if (snapshot.some((held) => held.contexts?.length))
        legacy.push({ streamId, snapshot })
    }
  }
  const sanitizer = new OutputSanitizer(
    combine([
      ...pending,
      ...contexts,
      ...legacy.flatMap(({ snapshot }) => released(snapshot)),
    ]),
  )
  for (const secret of await runningOutputSecrets(env, workspace))
    sanitizer.add(secret)
  const events = sanitizer.accept(input.event).map((event) => ({
    ...input,
    event:
      event.type === 'ports.updated'
        ? displayPortReport(event)
        : boundChatEvent(event),
  }))
  return {
    events,
    save: async () => {
      const snapshot = sanitizer.snapshot()
      const saveStream = async (streamId: string, held: HeldOutput[]) => {
        await transaction.output.save(
          streamId,
          held.length
            ? await encrypt(
                JSON.stringify(held),
                streamContext(streamId),
                env.BOAT_KEY_ENCRYPTION_KEY,
              )
            : undefined,
        )
      }
      await saveStream(input.streamId, unreleased(snapshot))
      for (const { streamId, snapshot } of legacy)
        await saveStream(streamId, unreleased(snapshot))
      await transaction.output.saveContexts(
        await encrypt(
          JSON.stringify(released(snapshot)),
          context,
          env.BOAT_KEY_ENCRYPTION_KEY,
        ),
      )
    },
  }
}
