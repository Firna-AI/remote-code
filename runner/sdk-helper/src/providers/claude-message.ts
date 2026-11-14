import type { ProviderEvent } from '../generated/ProviderEvent'

interface Message {
  id: string
  blocks: Map<number, { partial: string; complete?: string }>
  nextBlock: number
  currentBlock: number | null
  userMessageIds: readonly string[]
}

/** SDK assistant frames are blocks. Only an explicit boundary ends a message. */
export class ClaudeMessages {
  private readonly messages = new Map<string, Message>()
  private readonly completed = new Set<string>()
  private readonly emit: (event: ProviderEvent) => void

  constructor(emit: (event: ProviderEvent) => void) {
    this.emit = emit
  }

  start(id: string, userIds: readonly string[]): void {
    this.finish()
    this.message(id, userIds)
  }

  block(
    id: string,
    index: number,
    text: string,
    userIds: readonly string[],
  ): void {
    const message = this.message(id, userIds)
    message.currentBlock = index
    message.blocks.set(index, { partial: text })
  }

  delta(
    id: string,
    index: number | null,
    text: string,
    userIds: readonly string[],
  ): void {
    const message = this.message(id, userIds)
    const key = index ?? message.currentBlock ?? 0
    const block = message.blocks.get(key) ?? { partial: '' }
    block.partial += text
    message.blocks.set(key, block)
  }

  frame(
    id: string,
    blocks: readonly Record<string, unknown>[],
    userIds: readonly string[],
  ): void {
    if (this.completed.has(id)) return
    const message = this.message(id, userIds)
    const first =
      blocks.length === 1 && message.currentBlock !== null
        ? message.currentBlock
        : message.nextBlock
    for (const [offset, block] of blocks.entries()) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue
      message.blocks.set(first + offset, { partial: '', complete: block.text })
    }
    message.nextBlock = Math.max(message.nextBlock, first + blocks.length)
  }

  discard(id: string): void {
    this.messages.delete(id)
    this.completed.add(id)
  }

  finish(id?: string): void {
    for (const [key, message] of this.messages) {
      if (id !== undefined && key !== id) continue
      this.messages.delete(key)
      this.completed.add(key)
      const text = [...message.blocks]
        .sort(([a], [b]) => a - b)
        .map(([, block]) => block.complete ?? block.partial)
        .join('')
      if (
        text &&
        !/^\[Request interrupted by user(?: for tool use)?\]$/.test(text.trim())
      )
        this.emit({
          type: 'answer',
          messageId: key,
          text,
          userMessageIds: message.userMessageIds,
        })
    }
  }

  private message(id: string, userIds: readonly string[]): Message {
    let message = this.messages.get(id)
    if (!message) {
      message = {
        id,
        blocks: new Map(),
        nextBlock: 0,
        currentBlock: null,
        userMessageIds: [...userIds],
      }
      this.messages.set(id, message)
    } else if (userIds.length) message.userMessageIds = [...userIds]
    return message
  }
}
