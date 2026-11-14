import type { TurnSpeed } from './generated/TurnSpeed'
import type { Session } from './generated/Session'
import type { MessageSender } from './generated/MessageSender'
import type { UserMessage } from './generated/UserMessage'
import type { RunnerEvent } from './generated/RunnerEvent'
import type { AgentChatEvent } from './generated/AgentChatEvent'
import type { TurnStopRequester } from './session-stop'

/**
 * Maximum UTF-8 bytes of JSON.stringify(non-null detail), including quotes
 * and JSON escapes. A 64 KiB excerpt keeps tool output below the event budget.
 */
export const TOOL_DETAIL_MAX_BYTES = 65_536

/** Bound the chat summary work. The Changes tab keeps the complete file list. */
export const TURN_COMPLETED_MAX_FILES = 200

/**
 * Maximum UTF-8 bytes of JSON.stringify(turn.completed.files), including
 * brackets, commas, and escapes. This bounds lists with very long file paths.
 */
export const TURN_COMPLETED_FILES_MAX_BYTES = 262_144

/** Causes are machine codes. Unknown codes have no display text. */
export function readTurnSpeed(value: unknown): TurnSpeed | undefined {
  if (typeof value !== 'object' || value === null || !('state' in value))
    return undefined
  if (value.state === 'fast') return { state: 'fast' }
  if (value.state !== 'standard') return undefined
  if (!('cause' in value) || value.cause === undefined)
    return { state: 'standard' }
  if (
    typeof value.cause !== 'string' ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(value.cause)
  )
    return undefined
  return { state: 'standard', cause: value.cause }
}

export type RunnerEventRefusalReason =
  'too_large' | 'invalid' | 'turn_not_active'

/**
 * The workspace stores this event instead of a refused runner event.
 * Its identity prevents a resend from making a second marker.
 * Keep a recognized discriminator, or use unknown for an invalid discriminator.
 * Include only verified turn context. A workspace-level refusal uses nulls.
 * Session refusals name lost data in chat. Workspace report losses request repair.
 * A failed repair can show a notice beside its data. Never copy raw lost data.
 */
export interface RunnerEventRefused {
  type: 'runner.event-refused'
  streamId: string
  runnerEventNumber: number
  runnerEventType: RunnerEvent['type'] | 'unknown'
  reason: RunnerEventRefusalReason
  sessionId: string | null
  turnId: string | null
  /** Only the workspace sets this when a requested full replacement is refused. */
  repairFailed?: true
}

export type ChatEvent =
  | AgentChatEvent
  | {
      type: 'workspace.continued'
      sessionId: string
      member: MessageSender
      branch: string
      baseBranch: string
    }
  | RunnerEventRefused
  | { type: 'message.accepted'; message: UserMessage }
  | {
      type: 'message.sent'
      sessionId: string
      messageId: string
      turnId: string
    }
  | { type: 'session.updated'; session: Session }
  | ({
      /** Only the workspace records a Stop request. */
      type: 'turn.stop-requested'
      sessionId: string
      turnId: string
    } & TurnStopRequester)
