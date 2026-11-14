import type { AgentChatEvent } from '../generated/AgentChatEvent'
import type { RunnerEventRefused } from '../chat-events'
import type { Transcript, TranscriptItem } from './transcript'

/** A turn of the session that an accepted event named. */
export interface KnownTurn {
  id: string
  /** Its end arrived: a completion, a failure, or a refused end while it ran. */
  ended: boolean
  /** The messages that the turn took: at its start, and sent into it. */
  messageIds: readonly string[]
}

/**
 * A known turn has ended when its end arrived, or when a newer turn started,
 * because a session runs one turn at a time.
 */
export function hasEnded(transcript: Transcript, turnId: string): boolean {
  const { turns } = transcript
  const index = turns.findIndex((known) => known.id === turnId)
  return index >= 0 && (turns[index].ended || index < turns.length - 1)
}

/**
 * The failed item that offers Try again: it names the message that the
 * newest record of the session names. A turn that continues the unanswered
 * messages of a finished turn takes their IDs, so a late failure of the
 * older turn can name the same message. Then only the item of the newer
 * turn offers it.
 */
export function retryItemId(transcript: Transcript): string | null {
  const { retryMessageId, turns } = transcript
  if (retryMessageId === null) return null
  let chosen: { id: string; rank: number } | null = null
  for (const item of transcript.items) {
    if (item.kind !== 'failed' || item.retryMessageId !== retryMessageId) {
      continue
    }
    const rank = turns.findIndex((turn) => turn.id === item.turnId)
    if (!chosen || rank > chosen.rank) chosen = { id: item.id, rank }
  }
  return chosen?.id ?? null
}

/** The turn runs: it is the newest known turn, and its end has not arrived. */
export function isRunning(transcript: Transcript, turnId: string): boolean {
  const newest = transcript.turns.at(-1)
  return newest !== undefined && newest.id === turnId && !newest.ended
}

/**
 * Records an accepted event of a turn that has not ended. A turn that no
 * accepted event named before becomes the newest. A start adds its messages,
 * and an end ends the turn.
 */
export function noteTurn(
  turns: readonly KnownTurn[],
  event: AgentChatEvent,
): readonly KnownTurn[] {
  const started = event.type === 'turn.started' ? event.messageIds : []
  const known = turns.some((turn) => turn.id === event.turnId)
  const noted = known
    ? turns
    : [...turns, { id: event.turnId, ended: false, messageIds: [] }]
  const ends = event.type === 'turn.completed' || event.type === 'turn.failed'
  return noted.map((turn) =>
    turn.id === event.turnId
      ? {
          ...turn,
          ended: turn.ended || ends,
          messageIds: [...new Set([...turn.messageIds, ...started])],
        }
      : turn,
  )
}

/** Marks a known turn as ended, such as after its refused end. */
export function endTurn(
  turns: readonly KnownTurn[],
  turnId: string,
): readonly KnownTurn[] {
  return turns.map((turn) =>
    turn.id === turnId ? { ...turn, ended: true } : turn,
  )
}

/** Adds a message that went into a known turn, such as a steer message. */
export function takeMessage(
  turns: readonly KnownTurn[],
  turnId: string,
  messageId: string,
): readonly KnownTurn[] {
  return turns.map((turn) =>
    turn.id === turnId && !turn.messageIds.includes(messageId)
      ? { ...turn, messageIds: [...turn.messageIds, messageId] }
      : turn,
  )
}

/** The turn of an item: of its message, of its marker, or its own turn. */
export function turnOf(
  transcript: Transcript,
  item: TranscriptItem,
): string | null {
  switch (item.kind) {
    case 'user':
      return (
        transcript.turns.find((turn) =>
          turn.messageIds.includes(item.message.id),
        )?.id ?? null
      )
    case 'lost':
      return item.marker.turnId
    case 'continued':
      return null
    default:
      return item.turnId
  }
}

/**
 * The marker names a refused end of a turn: a completion or a failure that
 * the workspace refused for its size or its form. A turn that never started
 * has no end to refuse.
 */
export function endsTurn(event: RunnerEventRefused): boolean {
  return (
    event.reason !== 'turn_not_active' &&
    (event.runnerEventType === 'turn.completed' ||
      event.runnerEventType === 'turn.failed')
  )
}
