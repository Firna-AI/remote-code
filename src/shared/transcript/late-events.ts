import type { AgentChatEvent } from '../generated/AgentChatEvent'
import { endKey, failedKey, stoppedKey, toolKey } from './item-keys'
import { isEnd, placeInTurn } from './item-placement'
import type { Transcript, TranscriptItem } from './transcript'
import {
  agentItem,
  markSent,
  settleStops,
  settleTools,
  stopperOf,
} from './turn-events'

/**
 * A late end of a turn. The turn keeps the row where it ended, such as the
 * member who stopped it, and the files of this end show as a file row before
 * that row. A turn without an end row takes this end as its row.
 */
function foldLateEnd(
  transcript: Transcript,
  event: Extract<AgentChatEvent, { type: 'turn.completed' }>,
): Transcript {
  const { turnId } = event
  let items: readonly TranscriptItem[] = settleTools(
    markSent(transcript.items, event.userMessageIds),
    turnId,
    'stopped',
  )
  if (event.state === 'stopped' && !items.some((item) => isEnd(item, turnId))) {
    const source = stopperOf(transcript, turnId)
    const id = stoppedKey(turnId)
    items = placeInTurn(
      transcript,
      items,
      { kind: 'stopped', id, turnId, ...source },
      true,
    )
  }
  if (event.state === 'finished' || event.files.length > 0) {
    const row = {
      kind: 'turn-end',
      id: endKey(turnId),
      turnId,
      durationMs: event.durationMs,
      files: event.files,
    } as const
    items = placeInTurn(transcript, items, row, true)
  }
  return {
    ...transcript,
    items,
    turnCompletions: { ...transcript.turnCompletions, [turnId]: event },
    stopRequests: settleStops(transcript, turnId),
  }
}

/**
 * Applies an accepted event of a turn that has ended, such as one that the
 * runner sends again after its cloud computer resumes. The turn stays ended:
 * no Working row or Stop comes back, a running tool shows as stopped, and the
 * newest turn and a running turn stay as they are. New text, tool steps, and
 * the files of a late end show inside their own turn.
 */
export function foldLate(
  transcript: Transcript,
  event: AgentChatEvent,
): Transcript {
  const { items } = transcript
  switch (event.type) {
    case 'turn.started':
      return { ...transcript, items: markSent(items, event.messageIds) }
    case 'turn.thinking':
      return transcript
    case 'assistant.delta':
    case 'assistant.completed': {
      const item = agentItem(items, event)
      return {
        ...transcript,
        items: placeInTurn(transcript, items, item, true),
      }
    }
    case 'tool.updated': {
      const { tool } = event
      const state = tool.state === 'running' ? 'stopped' : tool.state
      const item = {
        kind: 'tool',
        id: toolKey(event.turnId, tool.id),
        turnId: event.turnId,
        tool: { ...tool, state },
      } as const
      return {
        ...transcript,
        items: placeInTurn(transcript, items, item, true),
      }
    }
    case 'turn.completed':
      return foldLateEnd(transcript, event)
    case 'turn.failed': {
      const item = {
        kind: 'failed',
        id: failedKey(event.turnId),
        turnId: event.turnId,
        error: event.error,
        retryMessageId: event.retryMessageId,
      } as const
      const settled = settleTools(items, event.turnId, 'stopped')
      return {
        ...transcript,
        items: placeInTurn(transcript, settled, item, true),
      }
    }
  }
}
