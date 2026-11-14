import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import { array, object, string } from '../parse'
import { InputQueue } from './queue'

const MAX_OUTSTANDING_MESSAGES = 64

type UserMessage = SDKUserMessage & { uuid: string }

export class ClaudeInputWindow implements AsyncIterable<SDKUserMessage> {
  readonly ids = new Map<string, string>()
  private readonly input = new InputQueue<SDKUserMessage>()
  private readonly held: { id: string; value: UserMessage }[] = []
  private readonly outstanding = new Set<string>()
  private closed = false

  get pending(): boolean {
    return this.held.length > 0 || this.outstanding.size > 0
  }

  push(id: string, value: UserMessage): void {
    if (this.closed) throw new Error('The agent input is closed.')
    this.held.push({ id, value })
    this.release()
  }

  complete(value: unknown): void {
    const result = object(value)
    const uuids = Array.isArray(result.user_message_uuids)
      ? array(result.user_message_uuids, string)
      : typeof result.user_message_uuid === 'string'
        ? [result.user_message_uuid]
        : []
    for (const uuid of uuids) {
      if (this.ids.has(uuid)) this.outstanding.delete(uuid)
    }
    this.release()
  }

  hasOutstanding(uuid: string): boolean {
    return this.outstanding.has(uuid)
  }

  discard(): void {
    this.closed = true
    this.held.length = 0
    this.outstanding.clear()
    this.ids.clear()
    this.input.discard()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return this.input[Symbol.asyncIterator]()
  }

  private release(): void {
    while (
      !this.closed &&
      this.outstanding.size < MAX_OUTSTANDING_MESSAGES &&
      this.held.length
    ) {
      const next = this.held.shift()
      if (!next) break
      this.ids.set(next.value.uuid, next.id)
      this.outstanding.add(next.value.uuid)
      this.input.push(next.value)
    }
  }
}
