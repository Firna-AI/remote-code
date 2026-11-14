import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import type { OrderedWorkspaceResponse } from '../../shared/workspaces'
import { afterRestore, isArchived } from './archive-view'
import type { ChatSnapshot } from './chat-snapshot'
import type { ChatContext } from './context'

/**
 * The snapshot with a newer workspace record. A record that leaves the
 * archived state ends the read-only tabs, as `afterRestore` says.
 */
function withRecord(
  snapshot: ChatSnapshot,
  workspace: Workspace,
): ChatSnapshot {
  const restored = isArchived(snapshot) && workspace.state !== 'archived'
  const next = { ...snapshot, workspace }
  return restored ? afterRestore(next) : next
}

/**
 * Shows the workspace record, its start steps, and its saved error of a
 * read or a reply when no newer state of them has shown, and says whether
 * they showed.
 */
export function confirmWorkspace(
  context: ChatContext,
  reply: Pick<
    OrderedWorkspaceResponse,
    'workspace' | 'start' | 'error' | 'eventNumber'
  >,
): boolean {
  if (!context.live()) return false
  const newer = reply.eventNumber >= context.workspaceOrder.through
  if (!newer) return false
  context.workspaceOrder.through = reply.eventNumber
  context.store.update((snapshot) => ({
    ...withRecord(snapshot, reply.workspace),
    start: reply.start,
    savedError: reply.error?.message ?? null,
  }))
  return true
}

/**
 * A change of the workspace record from the stream, at its number. An
 * update without `error` keeps the saved error, and null clears it.
 */
type WorkspaceChange =
  | {
      type: 'workspace.updated'
      workspace: Workspace
      error?: { message: string } | null
    }
  | { type: 'workspace.title'; name: string }
  | { type: 'start.updated'; start: WorkspaceStart }

/**
 * The snapshot after a change of the workspace record from the stream. A
 * change that is not newer than the record that shows changes nothing.
 */
export function withWorkspaceChange(
  context: ChatContext,
  snapshot: ChatSnapshot,
  change: WorkspaceChange,
  eventNumber: number,
): ChatSnapshot {
  if (eventNumber <= context.workspaceOrder.through) return snapshot
  context.workspaceOrder.through = eventNumber
  switch (change.type) {
    case 'workspace.updated':
      return {
        ...withRecord(snapshot, change.workspace),
        savedError:
          change.error === undefined
            ? snapshot.savedError
            : (change.error?.message ?? null),
      }
    case 'start.updated':
      return { ...snapshot, start: change.start }
    case 'workspace.title':
      return snapshot.workspace
        ? {
            ...snapshot,
            workspace: { ...snapshot.workspace, name: change.name },
          }
        : snapshot
  }
}
