import type { Session } from '../generated/Session'
import type { AgentChatEvent } from '../generated/AgentChatEvent'

import { endTurn, isRunning } from './known-turns'
import { foldLate } from './late-events'
import type { Transcript } from './transcript'
import { endLostTurn } from './turn-events'

/**
 * Ends a turn that the workspace ended without an end event that the chat
 * took: a call that still runs shows as stopped, its Stop request clears,
 * and the turn no longer runs. Another running turn stays.
 */
export function endShownTurn(
  transcript: Transcript,
  turnId: string,
): Transcript {
  return {
    ...endLostTurn(transcript, turnId),
    turns: endTurn(transcript.turns, turnId),
  }
}

/**
 * Applies an agent event that the workspace marked as late: its turn had
 * ended. The event adds no turn and changes no newer running turn. When the
 * chat still shows its turn as running, the mark ends that turn first.
 */
export function foldMarkedLate(
  transcript: Transcript,
  event: AgentChatEvent,
): Transcript {
  const ended = isRunning(transcript, event.turnId)
    ? endShownTurn(transcript, event.turnId)
    : transcript
  return foldLate(ended, event)
}

/**
 * The turn that a session record names as started, with its stored start
 * time. The active turn of an accepted message has no start time until
 * dispatch, so the record names no started turn while the message waits.
 */
export function startedTurn(
  session: Pick<Session, 'activeTurnId' | 'activeTurnStartedAt'>,
): { turnId: string; startedAt: number } | null {
  const { activeTurnId, activeTurnStartedAt } = session
  if (activeTurnId === null || activeTurnStartedAt === null) return null
  return { turnId: activeTurnId, startedAt: activeTurnStartedAt }
}

/**
 * Applies a session record at its place in the event order. The record
 * names the active turn of the session at that place:
 *
 * - A turn that has not ended, and that the record no longer names, has
 *   ended in the workspace, whatever end event the chat got. It ends with
 *   its calls and its Stop request.
 * - A turn that the record names, and that the workspace started, runs from
 *   its stored start time, also before the chat gets an event of it. A
 *   turn that has ended in the chat stays ended.
 * - Its retry message replaces the one before, so the newest record names it.
 */
export function foldRecord(
  transcript: Transcript,
  session: Pick<
    Session,
    'activeTurnId' | 'activeTurnStartedAt' | 'retryMessageId'
  >,
): Transcript {
  const { activeTurnId, retryMessageId } = session
  let next = transcript
  for (const known of transcript.turns) {
    if (!known.ended && known.id !== activeTurnId) {
      next = endShownTurn(next, known.id)
    }
  }
  const started = startedTurn(session)
  if (started !== null) {
    next = startFromRecord(next, started.turnId, started.startedAt)
  }
  return next.retryMessageId === retryMessageId
    ? next
    : { ...next, retryMessageId }
}

/** The running turn that a record names, with the start time that it stores. */
function startFromRecord(
  transcript: Transcript,
  turnId: string,
  startedAt: number,
): Transcript {
  const known = transcript.turns.find((turn) => turn.id === turnId)
  if (!known) {
    return {
      ...transcript,
      turns: [
        ...transcript.turns,
        { id: turnId, ended: false, messageIds: [] },
      ],
      turn: { turnId, startedAt, choice: null, thinking: false },
    }
  }
  const { turn } = transcript
  if (known.ended || turn?.turnId !== turnId || turn.startedAt === startedAt) {
    return transcript
  }
  return { ...transcript, turn: { ...turn, startedAt } }
}
