import type { Workspace } from '../../shared/generated/Workspace'
import type { User } from '../../shared/api'

import { mayArchive, type OrgAccess } from '../permissions'
import type { OfferedActionId } from './commands'

/** An action that a part of the page offers, and what running it does. */
export interface OfferedAction {
  readonly id: OfferedActionId
  /**
   * The address that the action opens, so that its row is a link. A plain
   * click and Enter run `run`, as the control of the page does.
   */
  readonly href?: string
  readonly run: () => void
}

/** Where the actions of an offer go in the palette. */
type OfferScope =
  /** The actions of the open workspace, under its name. */
  | {
      readonly kind: 'workspace'
      readonly workspaceId: string
      readonly name: string
    }
  /** The actions of the workspace list of an org. */
  | { readonly kind: 'org'; readonly orgId: string }
  /** The actions of the window of the Mac app. */
  | { readonly kind: 'window' }

/**
 * What a part of the page offers to the palette while it shows. So the
 * palette offers only what the page offers to the person.
 */
export interface PaletteOffer {
  readonly scope: OfferScope
  readonly actions: readonly OfferedAction[]
}

/** What the workspace screen shows, which decides its actions. */
export interface WorkspacePage {
  access: OrgAccess
  workspace: Workspace
  viewer: Pick<User, 'id'>
  /** The page shows the tabs of the right column, as on desktop. */
  rightColumn: boolean
  /** The page shows the chat with its session tabs. */
  chat: boolean
  /** The page offers the Desktop tool, which the app can hide. */
  desktopTool: boolean
  /** The archived bar of the page offers Restore. */
  offersRestore: boolean
}

/** The actions that the screen of an open workspace offers. */
export type WorkspaceActionId = Exclude<
  OfferedActionId,
  'new-section' | 'hide-sidebar' | 'show-sidebar'
>

const goToActions: readonly WorkspaceActionId[] = [
  'go-to-all-files',
  'go-to-changes',
  'go-to-checks',
  'go-to-terminal',
  'go-to-preview',
  'go-to-desktop',
]

/**
 * The actions that the workspace screen offers to the person, in their
 * order. A read-only workspace, archived or in a suspended org, offers no
 * New session. Session history stays, because it changes nothing. The Go
 * to rows need the tabs of the right column, which an archived workspace
 * does not show. Go to Desktop also needs the Desktop tool. Archive
 * follows `mayArchive`. Restore workspace follows the archived bar of the
 * chat, which offers it to every member until its last day.
 */
export function workspaceActionIds(page: WorkspacePage): WorkspaceActionId[] {
  const { access, workspace } = page
  const archived = workspace.state === 'archived'
  const readOnly = access.suspended || archived
  const ids: WorkspaceActionId[] = []
  if (page.chat && !readOnly) ids.push('new-session')
  if (page.chat) ids.push('session-history')
  if (page.rightColumn && !archived) {
    ids.push(
      ...goToActions.filter((id) => id !== 'go-to-desktop' || page.desktopTool),
    )
  }
  if (mayArchive(access, workspace, page.viewer)) ids.push('archive-workspace')
  if (page.chat && page.offersRestore) ids.push('restore-workspace')
  return ids
}
