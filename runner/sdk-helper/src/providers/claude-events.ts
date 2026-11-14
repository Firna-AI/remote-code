import { array, object, string } from '../parse'
import { mapTool } from './tool'
import { assistantError, claudeOutcome } from './claude-outcome'
import { ClaudeMessages } from './claude-message'
import { ClaudeBackground } from './claude-background'
import type { ProviderEvent } from '../generated/ProviderEvent'
import { ClaudeSpeed } from './claude-speed'

export function synthetic(text: string): boolean {
  return /^\[Request interrupted by user(?: for tool use)?\]$/.test(text.trim())
}

/**
 * Claude names a tool of an MCP server `mcp__<server>__<tool>`. This gives
 * the tool part of such a name, or null for any other tool.
 */
function mcpTool(name: string): string | null {
  const [prefix, server, ...rest] = name.split('__')
  const tool = rest.join('__')
  return prefix === 'mcp' && server && tool ? tool : null
}

/** Parse SDK output as unknown. Only this module knows its event fields. */
export class ClaudeEvents {
  private messageId = ''
  private readonly tools = new Map<string, ReturnType<typeof mapTool>>()
  private userIds: string[] = []
  private errorKind: ReturnType<typeof assistantError> = null
  private readonly ids: Map<string, string>
  private readonly hasOutstanding: (uuid: string) => boolean
  private readonly emit: (event: ProviderEvent) => void
  private readonly messages: ClaudeMessages
  private readonly background: ClaudeBackground
  readonly speed: ClaudeSpeed
  stopped = false

  constructor(
    ids: Map<string, string>,
    emit: (event: ProviderEvent) => void,
    hasOutstanding: (uuid: string) => boolean,
    background = new ClaudeBackground(emit),
    fast = false,
  ) {
    this.ids = ids
    this.hasOutstanding = hasOutstanding
    this.emit = emit
    this.background = background
    this.messages = new ClaudeMessages(emit)
    this.speed = new ClaudeSpeed(emit, fast)
  }

  accept(value: unknown): void {
    const input = object(value)
    const wake = input.type === 'result' && !this.answersOutstandingInput(input)
    if (wake && !this.background.waited) return
    if (
      this.background.waited &&
      input.type === 'system' &&
      input.subtype === 'session_state_changed' &&
      input.state === 'running' &&
      ![...this.ids.keys()].some(this.hasOutstanding)
    )
      this.userIds = []
    if (this.background.accept(input)) return
    if (typeof input.session_id === 'string')
      this.emit({ type: 'conversation', id: input.session_id })
    if (wake) this.userIds = []
    else if (Array.isArray(input.user_message_uuids)) {
      this.userIds = array(input.user_message_uuids, string).flatMap((id) =>
        this.ids.has(id) ? [this.ids.get(id) ?? ''] : [],
      )
    } else if (
      typeof input.user_message_uuid === 'string' &&
      this.ids.has(input.user_message_uuid)
    ) {
      this.userIds = [this.ids.get(input.user_message_uuid) ?? '']
    }
    if (input.parent_tool_use_id) return
    this.speed.accept(input)
    if (input.type === 'stream_event') this.partial(object(input.event))
    if (input.type === 'system' && input.subtype === 'thinking_tokens')
      this.emit({ type: 'thinking' })
    if (input.type === 'assistant') {
      const kind = assistantError(input.error)
      if (kind) {
        this.errorKind = kind
        if (typeof object(input.message).id === 'string')
          this.messages.discard(string(object(input.message).id))
        return
      }
      if (input.isSynthetic === true) return
      const message = object(input.message)
      const id = string(message.id)
      const blocks = array(message.content, object)
      this.messages.frame(id, blocks, this.userIds)
      for (const block of blocks) {
        if (block.type === 'tool_use') this.beginTool(block)
      }
    }
    if (input.type === 'user') {
      const message = object(input.message)
      if (!Array.isArray(message.content)) return
      for (const block of array(message.content, object)) {
        if (
          block.type !== 'tool_result' ||
          typeof block.tool_use_id !== 'string'
        )
          continue
        this.messages.finish()
        const tool = this.tools.get(block.tool_use_id)
        if (tool)
          this.emit({
            type: 'tool',
            tool: {
              ...tool,
              state: block.is_error === true ? 'failed' : 'done',
            },
          })
      }
    }
    if (input.type === 'result') {
      this.messages.finish()
      const outcome = claudeOutcome(input, this.errorKind, this.stopped)
      if (outcome.state === 'failed') this.emit(outcome.failure)
      else if (wake) this.emit({ type: 'wake-up', state: outcome.state })
      else
        this.emit({
          type: 'result',
          state: outcome.state,
          userMessageIds: this.userIds,
        })
      this.stopped = false
      this.errorKind = null
    }
  }

  private answersOutstandingInput(input: Record<string, unknown>): boolean {
    const origin = input.origin
    if (
      typeof origin !== 'object' ||
      origin === null ||
      !('kind' in origin) ||
      origin.kind !== 'task-notification'
    )
      return true
    const uuids = Array.isArray(input.user_message_uuids)
      ? array(input.user_message_uuids, string)
      : typeof input.user_message_uuid === 'string'
        ? [input.user_message_uuid]
        : []
    return uuids.some(this.hasOutstanding)
  }

  private partial(event: Record<string, unknown>): void {
    if (event.type === 'message_start') {
      this.messageId = string(object(event.message).id)
      this.messages.start(this.messageId, this.userIds)
    }
    if (event.type === 'message_stop') this.messages.finish(this.messageId)
    if (event.type === 'content_block_start') {
      const block = object(event.content_block)
      if (typeof event.index === 'number')
        this.messages.block(
          this.messageId,
          event.index,
          typeof block.text === 'string' ? block.text : '',
          this.userIds,
        )
      if (block.type === 'tool_use') this.beginTool(block)
    }
    if (event.type === 'content_block_delta') {
      const delta = object(event.delta)
      if (delta.type === 'thinking_delta') this.emit({ type: 'thinking' })
      if (
        delta.type === 'text_delta' &&
        typeof delta.text === 'string' &&
        !synthetic(delta.text)
      ) {
        this.messages.delta(
          this.messageId,
          typeof event.index === 'number' ? event.index : null,
          delta.text,
          this.userIds,
        )
        this.emit({
          type: 'delta',
          messageId: this.messageId,
          text: delta.text,
        })
      }
    }
  }

  private beginTool(block: Record<string, unknown>): void {
    const id = string(block.id)
    const name = string(block.name)
    const tool = mapTool(id, name, block.input, 'running', mcpTool(name))
    this.tools.set(id, tool)
    this.emit({ type: 'tool', tool })
  }
}
