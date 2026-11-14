/**
 * Chat transcripts. Text in backticks renders as inline code.
 */

import type { TurnEndReason } from '../../../../src/shared/generated/TurnEndReason'
import type { TableCells } from '../../../../src/markdown/table-rows'
import type { LostReason, LostWhat } from '../components/chat/lostCopy'
import type { StandardSpeedCause } from '../components/chat/speedCopy'
import { agentStopConversations } from './agentStopConversations'
import { attachmentConversations } from './attachmentConversations'
import type { Attachment } from './attachments'
import { endpointConversations } from './endpointModels'
import {
  autocompleteStart,
  autocompleteTests,
  cutOffTurn,
  e2eRunning,
  history,
} from './autocompleteTurn'
import { backgroundConversations } from './backgroundConversations'
import { barConversations, type ContinuedItem } from './barConversations'
import type { ChangedFile } from './files'
import {
  headingConversations,
  type MessageHeading,
} from './headingConversations'
import { linkedConversations } from './linkedConversations'
import { listConversations, type MessageList } from './listConversations'
import { lostConversations } from './lostConversations'
import type { MacCommandRequest, MacCommandState } from './mac'
import { macConversations } from './macConversations'
import type { PersonKey } from './members'
import { linkedSession } from './sessions'
import { newWorkspaceConversations } from './newWorkspaceConversations'
import { speedConversations } from './speedConversations'
import { tableConversations } from './tableConversations'
import { unavailableConversations } from './unavailableConversations'
import { workConversations } from './workConversations'
import { conversationKeys } from './conversationKeys'
import { fileMentionConversations } from './fileMentions'
import { sessionLinkConversations } from './sessionLinkConversations'
import { workspaceLinkConversations } from './workspaceLinkConversations'

export type ToolKind = 'read' | 'search' | 'create' | 'edit' | 'run'

type ToolCallStatus = 'done' | 'running' | 'stopped'

/** A table in a message of the agent. A short row keeps only its own cells. */
export type MessageTable = { kind: 'table' } & TableCells<string>

/**
 * A block of a message of the agent: a paragraph, a heading, a table, or a
 * list.
 */
export type AgentBlock = string | MessageHeading | MessageTable | MessageList

export type ChatItem =
  | {
      kind: 'user'
      id: string
      text: string
      /** The files of the message, shown in its text or under it. */
      attachments?: readonly Attachment[]
      /** Waits in the queue of the workspace until the sandbox is ready. */
      queued?: boolean
      /** Sent while a turn runs: it joins that turn as a new part. */
      during?: true
    }
  | {
      kind: 'agent'
      id: string
      /** The blocks of the message, in order. */
      blocks: readonly AgentBlock[]
    }
  | {
      kind: 'tool'
      id: string
      tool: ToolKind
      target: string
      detail?: string
      /** The size of output that the runner left out of `detail`. */
      omittedDetailBytes?: number
      status: ToolCallStatus
    }
  | {
      /** A command that the agent asks to run on the Mac of the sender. */
      kind: 'mac-command'
      id: string
      request: MacCommandRequest
      state: MacCommandState
    }
  | {
      /**
       * A stopped turn. All members see the same chat, so the item records
       * `by`, the member who pressed Stop (decision 72). A turn that stopped
       * with no Stop, such as when the cloud computer stopped, has no `by`.
       */
      kind: 'stopped'
      id: string
      by?: PersonKey
      /**
       * The session link of the session whose agent stopped the turn with a
       * workspace tool, also through a close of the session. The line names
       * that session in place of a member.
       */
      from?: string
      /** The changed files of the turn past the 200 that the runner lists. */
      omittedFiles?: number
      /** The cloud computer could not read the changed files. */
      filesUnavailable?: true
      /** Why a fast turn ran at standard speed (fast mode decision 257). */
      standardSpeed?: StandardSpeedCause
    }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'working'; id: string; elapsed: string }
  | {
      kind: 'turn-end'
      id: string
      duration: string
      files: readonly ChangedFile[]
      /** The files of the turn past the 200 that the runner lists. */
      omittedFiles?: number
      /** The cloud computer could not read the changed files: none listed. */
      filesUnavailable?: true
      /** A cause other than the end of the reply ended the turn. */
      endReason?: TurnEndReason
      /**
       * Why a fast turn ran at standard speed (fast mode decision 257). A
       * fast turn at fast speed and a turn without fast mode have none.
       */
      standardSpeed?: StandardSpeedCause
    }
  | {
      /** A runner event that the workspace refused (decision 76). */
      kind: 'lost'
      id: string
      what: LostWhat
      reason: LostReason
    }
  | {
      /**
       * The first line of a linked session. A member's message in another
       * session opened it, because the login of the starter of that session
       * was not available, or that starter did not let other members use
       * it. `from` is the title of that session, which the line links to.
       */
      kind: 'linked'
      id: string
      from: string
    }
  | ContinuedItem

/** One tool call of an agent turn. */
export type ToolCallItem = Extract<ChatItem, { kind: 'tool' }>

export type ConversationKey = (typeof conversationKeys)[number]

/**
 * The next message that a user writes after the turn ends. When the login
 * of the starter is not available, this message opens the linked session,
 * so its text is the first message of that session.
 */
export const followUpDraft = linkedSession.firstMessage

/** The steer message that the user types while a turn runs. */
export const steerDraft =
  'Also debounce the lookups to 250 ms, so we stay under the rate limit.'

export const conversations: Readonly<
  Record<ConversationKey, readonly ChatItem[]>
> = {
  history,
  running: [
    ...autocompleteStart,
    ...autocompleteTests,
    e2eRunning,
    { kind: 'working', id: 'working', elapsed: '2m 41s' },
  ],
  steer: [
    ...autocompleteStart,
    ...autocompleteTests,
    e2eRunning,
    { kind: 'working', id: 'working', elapsed: '2m 58s' },
  ],
  interrupted: [...cutOffTurn, { kind: 'stopped', id: 'stopped', by: 'cal' }],
  /** The cloud computer stopped during the turn, and no member pressed Stop. */
  'sandbox-stopped': [...cutOffTurn, { kind: 'stopped', id: 'stopped' }],
  failed: [
    ...autocompleteStart,
    {
      kind: 'error',
      id: 'error',
      text: 'Claude is overloaded right now.',
    },
  ],
  ...endpointConversations({ history, followUp: followUpDraft }),
  ...newWorkspaceConversations,
  ...macConversations(history),
  ...lostConversations(history),
  ...unavailableConversations({ history, cutOff: cutOffTurn }),
  ...speedConversations({ history, cutOff: cutOffTurn }),
  ...agentStopConversations(cutOffTurn),
  ...backgroundConversations,
  ...linkedConversations,
  ...attachmentConversations(history),
  ...workspaceLinkConversations(history),
  ...sessionLinkConversations(history),
  ...fileMentionConversations(history),
  ...workConversations({
    start: autocompleteStart,
    tests: autocompleteTests,
    steer: steerDraft,
  }),
  ...tableConversations,
  ...barConversations({ history, cutOff: cutOffTurn }),
  ...listConversations,
  ...headingConversations,
}
