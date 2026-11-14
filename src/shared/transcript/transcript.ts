import type { AgentChoice } from '../generated/AgentChoice'
import type { AgentChatEvent } from '../generated/AgentChatEvent'
import type { ToolCall } from '../generated/ToolCall'
import type { ChangedFile } from '../generated/ChangedFile'
import type { MessageSender } from '../generated/MessageSender'
import type { UserMessage } from '../generated/UserMessage'
import type { StopSessionReference } from '../session-stop'
import type { ChatEvent, RunnerEventRefused } from '../chat-events'
import { continuedKey, userKey } from './item-keys'
import { hasEnded, noteTurn, takeMessage, type KnownTurn } from './known-turns'
import { foldLate } from './late-events'
import { foldRefused } from './refused-events'
import { foldTurn, markSent, replaceAt } from './turn-events'
import { foldMarkedLate, foldRecord } from './turn-records'

/** One part of a chat transcript, in the order that the chat shows it. */
export type TranscriptItem =
  | { kind: 'user'; id: string; message: UserMessage }
  | { kind: 'agent'; id: string; turnId: string; text: string }
  | { kind: 'tool'; id: string; turnId: string; tool: ToolCall }
  | {
      kind: 'turn-end'
      id: string
      turnId: string
      durationMs: number
      files: readonly ChangedFile[]
    }
  | {
      kind: 'stopped'
      id: string
      turnId: string
      /** The member who pressed Stop, or null for another stop source. */
      by: string | null
      from?: StopSessionReference
    }
  | {
      kind: 'failed'
      id: string
      turnId: string
      error: { code: string; message: string }
      retryMessageId: string
    }
  | {
      /** A runner event that the workspace refused, at its place in the chat. */
      kind: 'lost'
      id: string
      marker: RunnerEventRefused
    }
  | {
      /**
       * The note of Continue, at its place in the chat: the member who
       * pressed it, the new branch, and its base. It belongs to no turn.
       */
      kind: 'continued'
      id: string
      member: MessageSender
      branch: string
      baseBranch: string
    }

export interface RunningTurn {
  turnId: string
  startedAt: number
  choice: AgentChoice | null
  /** The agent thinks and has written nothing since its last step. */
  thinking: boolean
}

export interface Transcript {
  items: readonly TranscriptItem[]
  turn: RunningTurn | null
  /**
   * The turns that accepted events named, in the order of their first event,
   * and whether each one ended. The last one is the newest turn.
   */
  turns: readonly KnownTurn[]
  /**
   * The message that Try again may send again, as the newest record of the
   * session names it, or null. Only the failed item of that message offers
   * Try again. Each record sets it at its place in the event order.
   */
  retryMessageId: string | null
  /** Complete terminal data, including omitted files, without new rendering. */
  turnCompletions: Readonly<
    Record<string, Extract<AgentChatEvent, { type: 'turn.completed' }>>
  >
  /**
   * The first member or session that requested Stop, for each active turn. The
   * request alone ends nothing: the turn runs until it ends as stopped.
   */
  stopRequests: Readonly<Record<string, string | StopSessionReference>>
}

export const emptyTranscript: Transcript = {
  items: [],
  turn: null,
  turns: [],
  retryMessageId: null,
  turnCompletions: {},
  stopRequests: {},
}

/**
 * Applies the note of Continue at its place in the event order. Each new
 * branch has one note in a session, so a repeat of the note replaces it.
 */
function foldContinued(
  transcript: Transcript,
  event: Extract<ChatEvent, { type: 'workspace.continued' }>,
): Transcript {
  const item: TranscriptItem = {
    kind: 'continued',
    id: continuedKey(event.branch),
    member: event.member,
    branch: event.branch,
    baseBranch: event.baseBranch,
  }
  const index = transcript.items.findIndex((entry) => entry.id === item.id)
  const items =
    index < 0
      ? [...transcript.items, item]
      : replaceAt(transcript.items, index, item)
  return { ...transcript, items }
}

/**
 * Applies one chat event of a session to its transcript. The chat shows only
 * the messages that people sent. A message ID that no accepted message has,
 * such as one that the agent SDK added, shows nothing. A session record ends
 * and starts turns, as `foldRecord` says. An agent event that the workspace
 * marked `late` belongs to a turn that has ended, as `foldMarkedLate` says.
 */
export function foldEvent(
  transcript: Transcript,
  event: ChatEvent,
  occurredAt: number,
  late = false,
): Transcript {
  switch (event.type) {
    case 'workspace.continued':
      return foldContinued(transcript, event)
    case 'session.updated':
      return foldRecord(transcript, event.session)
    case 'runner.event-refused':
      if (event.sessionId === null) return transcript
      return foldRefused(transcript, event)
    case 'message.accepted': {
      const item: TranscriptItem = {
        kind: 'user',
        id: userKey(event.message.id),
        message: event.message,
      }
      const index = transcript.items.findIndex((entry) => entry.id === item.id)
      const items =
        index < 0
          ? [...transcript.items, item]
          : replaceAt(transcript.items, index, item)
      return { ...transcript, items }
    }
    case 'message.sent':
      return {
        ...transcript,
        items: markSent(transcript.items, [event.messageId]),
        turns: takeMessage(transcript.turns, event.turnId, event.messageId),
      }
    case 'turn.stop-requested':
      if (Object.hasOwn(transcript.stopRequests, event.turnId)) {
        return transcript
      }
      return {
        ...transcript,
        stopRequests: {
          ...transcript.stopRequests,
          [event.turnId]: event.requestedBySession ?? event.requestedById,
        },
      }
    default:
      if (late) return foldMarkedLate(transcript, event)
      if (hasEnded(transcript, event.turnId)) return foldLate(transcript, event)
      return foldTurn(
        { ...transcript, turns: noteTurn(transcript.turns, event) },
        event,
        occurredAt,
      )
  }
}
