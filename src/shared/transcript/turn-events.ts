import type { AgentChatEvent } from '../generated/AgentChatEvent'
import {
  agentKey,
  endKey,
  failedKey,
  stoppedKey,
  toolKey,
  userKey,
} from './item-keys'
import { placeInTurn } from './item-placement'
import type { RunningTurn, Transcript, TranscriptItem } from './transcript'

type AgentText = Extract<
  AgentChatEvent,
  { type: 'assistant.delta' | 'assistant.completed' }
>

export function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  return items.map((current, position) => (position === index ? item : current))
}

export function markSent(
  items: readonly TranscriptItem[],
  ids: readonly string[],
) {
  return items.map((item) =>
    item.kind === 'user' && ids.includes(item.message.id)
      ? { ...item, message: { ...item.message, state: 'sent' as const } }
      : item,
  )
}

/** A turn that ends leaves no call running. */
export function settleTools(
  items: readonly TranscriptItem[],
  turnId: string,
  state: 'done' | 'stopped',
): TranscriptItem[] {
  return items.map((item) =>
    item.kind === 'tool' &&
    item.turnId === turnId &&
    item.tool.state === 'running'
      ? { ...item, tool: { ...item.tool, state } }
      : item,
  )
}

/**
 * Places an answer after the last message that it answers, so a result
 * shows with every message that it answers, also one sent during the turn.
 */
function placeAnswer(
  items: TranscriptItem[],
  id: string,
  answers: readonly string[],
): TranscriptItem[] {
  const from = items.findIndex((item) => item.id === id)
  const last = Math.max(
    ...answers.map((answer) =>
      items.findIndex((item) => item.id === userKey(answer)),
    ),
  )
  if (from < 0 || last <= from) return items
  const answer = items[from]
  const moved = items.filter((_, index) => index !== from)
  moved.splice(last, 0, answer)
  return moved
}

/** The running turn after a turn ends: none, unless another turn runs. */
function ending(transcript: Transcript, turnId: string): RunningTurn | null {
  return transcript.turn && transcript.turn.turnId !== turnId
    ? transcript.turn
    : null
}

/** The member or session of the first Stop request in a turn. */
export function stopperOf(
  transcript: Transcript,
  turnId: string,
): Pick<Extract<TranscriptItem, { kind: 'stopped' }>, 'by' | 'from'> {
  const source = Object.hasOwn(transcript.stopRequests, turnId)
    ? transcript.stopRequests[turnId]
    : undefined
  return typeof source === 'string'
    ? { by: source }
    : { by: null, ...(source !== undefined && { from: source }) }
}

/** The Stop requests without the one of a turn that ended. */
export function settleStops(
  transcript: Transcript,
  turnId: string,
): Transcript['stopRequests'] {
  const { stopRequests } = transcript
  if (!Object.hasOwn(stopRequests, turnId)) return stopRequests
  return Object.fromEntries(
    Object.entries(stopRequests).filter(([id]) => id !== turnId),
  )
}

/**
 * Ends a turn whose end event the workspace refused. A call of the turn that
 * still runs shows as stopped, because the end did not say that it finished.
 * The chat keeps no Stop request of the turn, and no longer shows it as
 * running. Another running turn stays. No time, file, or retry data comes
 * back, because it was lost with the event.
 */
export function endLostTurn(
  transcript: Transcript,
  turnId: string,
): Transcript {
  return {
    ...transcript,
    items: settleTools(transcript.items, turnId, 'stopped'),
    turn: ending(transcript, turnId),
    stopRequests: settleStops(transcript, turnId),
  }
}

/** The text item of an agent message: a part adds to its earlier text. */
export function agentItem(
  items: readonly TranscriptItem[],
  event: AgentText,
): Extract<TranscriptItem, { kind: 'agent' }> {
  const id = agentKey(event.turnId, event.messageId)
  const current = items.find((item) => item.id === id)
  const previous = current?.kind === 'agent' ? current.text : ''
  const text =
    event.type === 'assistant.delta' ? previous + event.text : event.text
  return { kind: 'agent', id, turnId: event.turnId, text }
}

function writeAgent(
  transcript: Transcript,
  event: AgentText,
): TranscriptItem[] {
  const item = agentItem(transcript.items, event)
  const written = placeInTurn(transcript, transcript.items, item, false)
  return event.type === 'assistant.completed'
    ? placeAnswer(written, item.id, event.userMessageIds)
    : written
}

/**
 * Applies one event of an agent turn that has not ended: its start,
 * thinking, text, tool calls, and its end as finished, stopped, or failed.
 * Each item stays with its turn, before a message that waits for a later
 * turn. A stopped end names the member who first pressed Stop, if one did.
 */
export function foldTurn(
  transcript: Transcript,
  event: AgentChatEvent,
  occurredAt: number,
): Transcript {
  const { items } = transcript
  const turn: RunningTurn =
    transcript.turn?.turnId === event.turnId
      ? transcript.turn
      : {
          turnId: event.turnId,
          startedAt: occurredAt,
          choice: null,
          thinking: false,
        }
  const working = { ...turn, thinking: false }
  switch (event.type) {
    case 'turn.started':
      return {
        ...transcript,
        items: markSent(items, event.messageIds),
        turn: { ...working, startedAt: event.startedAt, choice: event.choice },
      }
    case 'turn.thinking':
      return { ...transcript, turn: { ...turn, thinking: true } }
    case 'assistant.delta':
    case 'assistant.completed':
      return {
        ...transcript,
        items: writeAgent(transcript, event),
        turn: working,
      }
    case 'tool.updated': {
      const item = {
        kind: 'tool',
        id: toolKey(event.turnId, event.tool.id),
        turnId: event.turnId,
        tool: event.tool,
      } as const
      return {
        ...transcript,
        items: placeInTurn(transcript, items, item, false),
        turn: working,
      }
    }
    case 'turn.completed': {
      const stopped = event.state === 'stopped'
      const ended = settleTools(
        markSent(items, event.userMessageIds),
        event.turnId,
        stopped ? 'stopped' : 'done',
      )
      const end = stopped
        ? {
            kind: 'stopped' as const,
            id: stoppedKey(event.turnId),
            turnId: event.turnId,
            ...stopperOf(transcript, event.turnId),
          }
        : {
            kind: 'turn-end' as const,
            id: endKey(event.turnId),
            turnId: event.turnId,
            durationMs: event.durationMs,
            files: event.files,
          }
      return {
        ...transcript,
        items: placeInTurn(transcript, ended, end, false),
        turn: ending(transcript, event.turnId),
        stopRequests: settleStops(transcript, event.turnId),
        turnCompletions: {
          ...transcript.turnCompletions,
          [event.turnId]: event,
        },
      }
    }
    case 'turn.failed': {
      const failed = {
        kind: 'failed' as const,
        id: failedKey(event.turnId),
        turnId: event.turnId,
        error: event.error,
        retryMessageId: event.retryMessageId,
      }
      const ended = settleTools(items, event.turnId, 'stopped')
      return {
        ...transcript,
        items: placeInTurn(transcript, ended, failed, false),
        turn: ending(transcript, event.turnId),
        stopRequests: settleStops(transcript, event.turnId),
      }
    }
  }
}
