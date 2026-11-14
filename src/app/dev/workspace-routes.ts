import type { Workspace } from '../../shared/generated/Workspace'
import {
  WORKSPACE_RESTORE_MS,
  workspacePath,
  workspacePaths,
  workspacesPath,
  type OrderedWorkspaceResponse,
  type WorkspaceResponse,
  type WorkspacesResponse,
} from '../../shared/workspaces'
import { choice, count, record, text } from '../api/parse'
import { failedFirstStart } from '../first-start'
import { moveWorkspace } from '../sections'
import {
  changeWorkspace,
  requireOrg,
  requireSection,
  requireWorkspace,
  workspaceDetail,
  type DevBackend,
} from './backend'
import {
  ID,
  json,
  noContent,
  optional,
  requiredText,
  RouteError,
  type Params,
  type Route,
} from './router'
import { cancelStart, resumeWorkspace, stopLater } from './start-steps'
import type { OrgState } from './state'

/**
 * The time of a change, which keeps the time of the last change as its
 * minimum, as the Worker does. Archive and Restore raise it also on the
 * same tick of the clock, so the app can order them.
 */
function changedAt(
  backend: DevBackend,
  workspace: Workspace,
  raise = false,
): number {
  return Math.max(backend.now(), workspace.updatedAt + (raise ? 1 : 0))
}

function detailReply(org: OrgState, workspaceId: string): Response {
  return json(workspaceDetail(org, workspaceId) satisfies WorkspaceResponse)
}

function orderedDetailReply(
  backend: DevBackend,
  org: OrgState,
  workspaceId: string,
): Response {
  return json({
    ...workspaceDetail(org, workspaceId),
    eventNumber: backend.eventNumber,
  } satisfies OrderedWorkspaceResponse)
}

/**
 * Rename, and the move of a drag. `position` is the index in the target
 * section without the moved workspace, and the list order follows it.
 */
function updateWorkspace(
  backend: DevBackend,
  org: OrgState,
  workspaceId: string,
  body: unknown,
): Response {
  const current = requireWorkspace(org, workspaceId)
  if (current.archivedAt !== null || current.state === 'archived') {
    throw new RouteError(
      409,
      'workspace_archived',
      'The archived chat is read-only.',
    )
  }
  const fields = record(body)
  const name = optional(fields, 'name', requiredText)
  const sectionId = optional(fields, 'sectionId', text)
  const position = optional(fields, 'position', count)
  if (sectionId !== undefined) requireSection(org, sectionId)
  if (sectionId !== undefined || position !== undefined) {
    org.workspaces = moveWorkspace(
      org.workspaces,
      org.sections,
      workspaceId,
      sectionId ?? current.sectionId,
      position ?? 0,
    )
  }
  const moved = requireWorkspace(org, workspaceId)
  changeWorkspace(backend, org, {
    ...moved,
    name: name ?? moved.name,
    updatedAt: changedAt(backend, moved),
  })
  return detailReply(org, workspaceId)
}

/** Reads detail and starts the stop preview for an active workspace. */
function readWorkspace(
  backend: DevBackend,
  org: OrgState,
  workspaceId: string,
): Response {
  const current = requireWorkspace(org, workspaceId)
  if (current.state !== 'stopped' && backend.state.stopAfterMs !== null) {
    stopLater(backend, org, workspaceId, backend.state.stopAfterMs)
  }
  return orderedDetailReply(backend, org, workspaceId)
}

/**
 * Archive stops the cloud computer at once, with no check, and keeps it for
 * the 14 days of Restore. A failed first start has no cloud computer to
 * keep. A repeat changes nothing. The chat stays read-only.
 */
function archiveWorkspace(
  backend: DevBackend,
  org: OrgState,
  workspaceId: string,
): Response {
  const current = requireWorkspace(org, workspaceId)
  if (current.state !== 'archived') {
    const saved = org.starts.get(workspaceId)?.start ?? null
    const first = failedFirstStart(current, saved)
    cancelStart(org, workspaceId)
    org.starts.set(workspaceId, { start: null, error: null })
    const at = backend.now()
    changeWorkspace(backend, org, {
      ...current,
      state: 'archived',
      archivedAt: at,
      restoreUntil: first ? null : at + WORKSPACE_RESTORE_MS,
      updatedAt: changedAt(backend, current, true),
    })
  }
  return detailReply(org, workspaceId)
}

/**
 * Restore puts an archived workspace back in its section, stopped, and
 * starts nothing. A repeat changes nothing. After the last day of Restore,
 * or without a kept cloud computer, it refuses, as the Worker does.
 */
function restoreWorkspace(
  backend: DevBackend,
  org: OrgState,
  workspaceId: string,
): Response {
  const current = requireWorkspace(org, workspaceId)
  if (current.state === 'archived') {
    const { restoreUntil } = current
    if (restoreUntil === null || backend.now() >= restoreUntil) {
      throw new RouteError(
        409,
        'workspace_restore_unavailable',
        restoreUntil === null
          ? 'No cloud computer is available to restore.'
          : 'The time to restore this workspace has ended.',
      )
    }
    changeWorkspace(backend, org, {
      ...current,
      state: 'stopped',
      archivedAt: null,
      restoreUntil: null,
      updatedAt: changedAt(backend, current, true),
    })
  }
  return detailReply(org, workspaceId)
}

/** Output that the open workspace shows counts as read. */
function markRead(
  backend: DevBackend,
  org: OrgState,
  workspaceId: string,
  body: unknown,
): Response {
  count(record(body), 'throughEventNumber')
  const current = requireWorkspace(org, workspaceId)
  if (current.state === 'unread') {
    changeWorkspace(backend, org, { ...current, state: 'ready' })
  }
  return noContent()
}

/**
 * The workspace list and the actions of one workspace. Create workspace
 * lives in `create-routes.ts`.
 */
export function workspaceRoutes(backend: DevBackend): Route[] {
  const orgOf = (params: Params) => requireOrg(backend.state, params.org)
  const one = workspacePath(ID.org, ID.workspace)
  return [
    {
      method: 'GET',
      path: workspacesPath(ID.org),
      answer: ({ params }) =>
        json({
          workspaces: orgOf(params).workspaces,
        } satisfies WorkspacesResponse),
    },
    {
      method: 'GET',
      path: one,
      answer: ({ params }) =>
        readWorkspace(backend, orgOf(params), params.workspace),
    },
    {
      method: 'PATCH',
      path: one,
      answer: ({ params, body }) =>
        updateWorkspace(backend, orgOf(params), params.workspace, body),
    },
    {
      method: 'POST',
      path: workspacePaths.resume(ID.org, ID.workspace),
      answer: ({ params }) => {
        const org = orgOf(params)
        resumeWorkspace(backend, org, params.workspace)
        return orderedDetailReply(backend, org, params.workspace)
      },
    },
    {
      method: 'POST',
      path: workspacePaths.archive(ID.org, ID.workspace),
      answer: ({ params }) =>
        archiveWorkspace(backend, orgOf(params), params.workspace),
    },
    {
      method: 'POST',
      path: workspacePaths.restore(ID.org, ID.workspace),
      answer: ({ params }) =>
        restoreWorkspace(backend, orgOf(params), params.workspace),
    },
    {
      method: 'PUT',
      path: workspacePaths.read(ID.org, ID.workspace),
      answer: ({ params, body }) =>
        markRead(backend, orgOf(params), params.workspace, body),
    },
    {
      method: 'POST',
      path: workspacePaths.activity(ID.org, ID.workspace),
      answer: ({ body }) => {
        choice(record(body), 'source', ['input', 'terminal', 'preview'])
        return noContent()
      },
    },
  ]
}
