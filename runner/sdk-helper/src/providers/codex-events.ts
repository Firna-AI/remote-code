import { object, oneOf, string } from '../parse'
import { synthetic } from './claude-events'
import { mapTool } from './tool'
import { failureCause } from './failure'
import type { ProviderEvent } from '../generated/ProviderEvent'

export function codexNotification(
  method: string,
  value: unknown,
  userMessageIds: readonly string[],
  emit: (event: ProviderEvent) => void,
): void {
  const input = object(value)
  if (method === 'item/agentMessage/delta') {
    const text = string(input.delta)
    if (!synthetic(text))
      emit({ type: 'delta', messageId: string(input.itemId), text })
  }
  if (method.startsWith('item/reasoning/')) emit({ type: 'thinking' })
  if (method === 'item/started' || method === 'item/completed') {
    const item = object(input.item)
    const type = string(item.type)
    if (type === 'agentMessage' && method === 'item/completed') {
      const text = string(item.text)
      if (!synthetic(text))
        emit({
          type: 'answer',
          messageId: string(item.id),
          text,
          userMessageIds: [...userMessageIds],
        })
    }
    if (
      [
        'commandExecution',
        'fileChange',
        'mcpToolCall',
        'webSearch',
        'dynamicToolCall',
      ].includes(type)
    ) {
      const state =
        method === 'item/started'
          ? 'running'
          : item.status === 'failed'
            ? 'failed'
            : item.status === 'declined'
              ? 'stopped'
              : 'done'
      const mcp = type === 'mcpToolCall'
      const server = typeof item.server === 'string' ? item.server : ''
      const tool = typeof item.tool === 'string' ? item.tool : ''
      emit({
        type: 'tool',
        tool: mapTool(
          string(item.id),
          mcp ? `${server}:${tool}` : type,
          mcp ? item.arguments : item,
          state,
          mcp && tool ? tool : null,
        ),
      })
    }
  }
  if (method === 'turn/completed') {
    const turn = object(input.turn)
    const status = oneOf(turn.status, ['completed', 'interrupted', 'failed'])
    if (status === 'failed') emit(failureCause(turn.error))
    else
      emit({
        type: 'result',
        state: status === 'interrupted' ? 'stopped' : 'finished',
        userMessageIds: [...userMessageIds],
      })
  }
  if (method === 'error' && input.willRetry !== true)
    emit(failureCause(input.error))
}
