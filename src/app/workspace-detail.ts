import type { Workspace } from '../shared/generated/Workspace'
import type { WorkspaceResponse } from '../shared/workspaces'
import type { ShellEvent } from './api/read-events'
import type { Change } from './resource'

/** Local name and owner replies change no other workspace detail fields. */
export function workspaceMetadata(
  fields: Partial<Pick<Workspace, 'name' | 'owner'>>,
): Change<WorkspaceResponse> {
  return (current) => ({
    ...current,
    workspace: { ...current.workspace, ...fields },
  })
}

/** Archive keeps the workspace record and ends its start and error state. */
function archivedDetail(workspace: Workspace): WorkspaceResponse {
  return { workspace, start: null, error: null }
}

const archived = (workspace: Workspace) => workspace.state === 'archived'

/**
 * Archive and Restore move a workspace across the archive boundary, and each
 * one raises `updatedAt` strictly. So a record on the other side of that
 * boundary is older than the shown one unless its `updatedAt` is greater.
 * A record on the same side follows the other order of its source.
 */
export function olderAcrossArchive(
  shown: Workspace,
  incoming: Workspace,
): boolean {
  return (
    archived(shown) !== archived(incoming) &&
    incoming.updatedAt <= shown.updatedAt
  )
}

/**
 * The floor of `updatedAt` after a record shows: the time of the newest
 * archived record, or of a Restore that left the archived state. A record
 * below it comes from before that Archive or Restore, on either side of the
 * boundary, because the Worker never lowers `updatedAt`. So a replay of an
 * older active record cannot lower the time that lets an older Archive in.
 */
export function archiveFloor(
  floor: number,
  shown: Workspace | undefined,
  next: Workspace,
): number {
  const restored = shown !== undefined && archived(shown) && !archived(next)
  return archived(next) || restored ? Math.max(floor, next.updatedAt) : floor
}

/**
 * The detail after an Archive or a Restore reply. It changes only the
 * fields of that action, so a newer name, owner, or section stays. A reply
 * that is not newer than the shown record changes nothing, such as one that
 * a later Resume, Archive, or Restore overtook.
 */
export function lifecycleReplyDetail(
  current: WorkspaceResponse,
  reply: WorkspaceResponse,
): WorkspaceResponse {
  if (reply.workspace.updatedAt <= current.workspace.updatedAt) return current
  const { state, archivedAt, restoreUntil, updatedAt } = reply.workspace
  return {
    ...current,
    start: reply.start,
    error: reply.error,
    workspace: {
      ...current.workspace,
      state,
      archivedAt,
      restoreUntil,
      updatedAt,
    },
  }
}

/**
 * The detail after the list learned of an Archive or a Restore that the
 * detail does not show yet, such as one from a row of the list. A newer
 * archived record also brings the end of Restore, such as the delete of the
 * kept cloud computer, before the stream does. Before the first read, an
 * archived list record shows at once, so the open resumes nothing. The
 * stream alone orders the records of a workspace that is not archived.
 * Undefined when the detail stays as it is.
 */
export function detailAfterListLifecycle(
  current: WorkspaceResponse | undefined,
  listed: Workspace | undefined,
): WorkspaceResponse | undefined {
  if (!listed) return undefined
  if (!current) return archived(listed) ? archivedDetail(listed) : undefined
  if (!archived(current.workspace) && !archived(listed)) return undefined
  const next = lifecycleReplyDetail(current, archivedDetail(listed))
  return next === current ? undefined : next
}

/**
 * The detail after an event of the stream. A workspace record applies its
 * saved public error with its state: a record without the error keeps the
 * current error, and null clears it. An event error carries no log, so the
 * detail keeps a null log for it.
 */
export function workspaceAfterEvent(
  detail: WorkspaceResponse,
  event: ShellEvent,
): WorkspaceResponse {
  if (
    detail.workspace.state === 'archived' &&
    event.type !== 'workspace.updated'
  ) {
    return detail
  }
  switch (event.type) {
    case 'workspace.updated':
      return {
        ...detail,
        workspace: event.workspace,
        ...(event.error === undefined
          ? {}
          : {
              error:
                event.error === null ? null : { ...event.error, log: null },
            }),
      }
    case 'start.updated':
      return { ...detail, start: event.start }
    case 'workspace.title':
      return { ...detail, workspace: { ...detail.workspace, name: event.name } }
  }
}
