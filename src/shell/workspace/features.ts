import type { Workspace } from '../../shared/generated/Workspace'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SandboxPanelState } from '../../../docs/mockups/src/components/workspace/sandboxNoticeState'
import type { ArchiveAction } from '../../app/archive-model'
import type { WorkspaceStream } from '../../app/events'
import type { ChatController } from '../../chat/state/controller'
import type { User } from '../../shared/api'
import type { OrgSummary } from '../../shared/orgs'

import type { SubscribeWorkspaceEvents } from '../../terminal/tool-parts/workspace'
import type { Action } from '../ui/useAction'
import type { Viewport } from '../ui/viewport'
import { appFeatures } from './app-features'

/** The cloud computer of the open workspace, as the panels show it. */
export type SandboxState =
  'ready' | 'starting' | 'stopped' | 'error' | 'archived'

/**
 * The kept chat as the owner of the saved workspace view: the open tabs,
 * the active tab, the list, and the tool. The chat loads the view, and
 * `updateView` saves each change through its one writer.
 */
export type SavedView = Pick<
  ChatController,
  'subscribe' | 'getSnapshot' | 'updateView'
>

/**
 * The kept chat as the pull request bar uses it: its snapshot, the select of
 * a session, and the send of a fixed prompt to the session of the chat.
 */
type ChatActions = Pick<
  ChatController,
  'subscribe' | 'getSnapshot' | 'select' | 'sendPrompt'
>

/** What a feature of the workspace gets from the shell. */
export interface WorkspaceContext {
  org: OrgSummary
  workspace: Workspace
  /** The person signed in. */
  viewer: User
  sandbox: SandboxState
  /**
   * The workspace takes no change: it is archived, or its org is suspended.
   * A feature then shows its history only, and sends no write, also none
   * for a view, such as a switch of the session tab.
   */
  readOnly: boolean
  /**
   * What a part shows in place of its content while the sandbox does not
   * run: the notice of the bar, with the words of a refused start, or the
   * wait of a start. Null while the sandbox runs.
   */
  panel: SandboxPanelState | null
  /**
   * The open of the workspace resumes its sandbox and has not ended. The
   * header then shows Starting, and a part that shows the state of the
   * sandbox in place of its content shows the wait of a start, with no
   * Resume. The lists keep their saved copy.
   */
  resumingAtOpen: boolean
  /**
   * Resume, or Try again after a failed start. A phone shows it on a part
   * that shows the state of the sandbox in place of its content.
   */
  resume: Action<[]>
  viewport: Viewport
  /** The address after the workspace, such as `['files']` or `['terminal']`. */
  view: readonly string[]
  /** The ordered events of the workspace: each event once, in order. */
  stream: WorkspaceStream
  /** The saved view of the workspace, which a feature reads and changes. */
  savedView: SavedView
  /** The kept chat, through which the bar sends its fixed prompts. */
  chat: ChatActions
  /**
   * The events that the tools read: the updates of the workspace and the
   * revokes of its previews, the stored revokes first.
   */
  toolEvents: SubscribeWorkspaceEvents
  /** Archives at once, or `null` when the viewer may not archive. */
  archive: (() => void) | null
  /**
   * Restores the archived workspace, or `null` when it offers no Restore:
   * after its last day of Restore, without a kept cloud computer, or in a
   * suspended org.
   */
  restore: (() => void) | null
  /** The Archive or the Restore that runs, which its control shows busy. */
  running: ArchiveAction | null
  /**
   * Takes the workspace of the API's answer after the owner picker assigns
   * another owner, so the header and the start state follow at once.
   */
  onReassigned: (workspace: Workspace) => void
}

type WorkspaceSlot = (context: WorkspaceContext) => ReactNode

/**
 * The parts that later milestones put into the shell of a workspace. The
 * shell draws the frame, the header, the start steps, and the sandbox
 * states, and the chat of the workspace fills the centre. A missing part
 * leaves its place empty. A host that gives `tabs`, `transcript`, or
 * `composer` gets the shell's own chat column with those parts in place of
 * the chat.
 */
export interface WorkspaceFeatures {
  /** The tabs above the shell's own chat column, in place of the chat. */
  tabs?: WorkspaceSlot
  /** The history of the shell's own chat column. The start steps follow it. */
  transcript?: WorkspaceSlot
  /** The composer of the shell's own chat column while the sandbox runs or starts. */
  composer?: WorkspaceSlot
  /**
   * A part in place of the whole chat, or `null` for the chat. Without it,
   * the chat keeps its tabs and shows the file or diff tab of the address
   * in place of the chat of its session.
   */
  center?: (context: WorkspaceContext) => ReactNode | null
  /** The pull request bar, or the compact row on a phone (Milestone 14). */
  pullRequest?: WorkspaceSlot
  /** All files, Changes, and Checks (Milestones 10 and 14). */
  files?: WorkspaceSlot
  /**
   * A part in place of the shell's own Terminal, Preview, and Desktop tools.
   * While the sandbox does not run, the shell shows its state in place of
   * this part.
   */
  tools?: WorkspaceSlot
  /** The owner picker that reassigns the workspace (Milestone 15c). */
  owner?: WorkspaceSlot
}

/** The parts that the host gives. They take the place of the app's own. */
export const FeaturesContext = createContext<WorkspaceFeatures>({})

/** The parts of the workspace: the app's own, under those of the host. */
export function useFeatures(): WorkspaceFeatures {
  const host = useContext(FeaturesContext)
  return useMemo(() => ({ ...appFeatures, ...host }), [host])
}

/** The sandbox state that a workspace state shows in the panels. */
export function sandboxState(workspace: Workspace): SandboxState {
  switch (workspace.state) {
    case 'starting':
    case 'stopped':
    case 'error':
    case 'archived':
      return workspace.state
    case 'working':
    case 'input':
    case 'unread':
    case 'ready':
      return 'ready'
  }
}
