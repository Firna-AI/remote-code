import type { Workspace } from '../../src/shared/generated/Workspace'
import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'

import { HttpError } from '../http'
import { workspaceNameColumn } from '../data/workspace-name'

export async function workspaceOrg(
  db: D1Database,
  workspaceId: string,
): Promise<string> {
  const row = await db
    .prepare('SELECT org_id AS orgId FROM workspaces WHERE id = ?')
    .bind(workspaceId)
    .first<{ orgId: string }>()
  if (!row)
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  return row.orgId
}

export interface WorkspaceRow {
  id: string
  number: number
  orgId: string
  repositoryId: string
  sectionId: string
  name: string | null
  branch: string
  state: WorkspaceState
  github: Workspace['github']
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  sandboxId: string | null
  ownerId: string
  githubLogin: string
  displayName: string | null
  avatarUrl: string | null
}

export function readDeviceWorkspace(db: D1Database, workspaceId: string) {
  return db
    .prepare(
      `SELECT w.id, w.number, w.org_id AS orgId, w.repository_id AS repositoryId,
    COALESCE(w.section_id, s.id) AS sectionId, ${workspaceNameColumn('w')}, w.branch, w.state,
    w.github_summary AS github,
    w.created_at AS createdAt, w.updated_at AS updatedAt, w.archived_at AS archivedAt,
    w.sandbox_id AS sandboxId,
    u.id AS ownerId, u.github_login AS githubLogin, u.display_name AS displayName, u.avatar_url AS avatarUrl
    FROM workspaces w JOIN users u ON u.id = w.owner_user_id
    LEFT JOIN sections s ON s.org_id = w.org_id AND s.is_default = 1
    WHERE w.id = ?`,
    )
    .bind(workspaceId)
    .first<WorkspaceRow>()
}

export function enterDeviceInput(
  db: D1Database,
  workspaceId: string,
  state: WorkspaceState,
  now: number,
) {
  return db
    .prepare(
      `UPDATE workspaces SET state = 'input', updated_at = MAX(updated_at, ?)
    WHERE id = ? AND state = ? AND archived_at IS NULL`,
    )
    .bind(now, workspaceId, state)
    .run()
}
export function restoreDeviceInput(
  db: D1Database,
  workspaceId: string,
  state: WorkspaceState,
  now: number,
) {
  return db
    .prepare(
      `UPDATE workspaces SET state = ?, updated_at = MAX(updated_at, ?)
    WHERE id = ? AND state = 'input' AND archived_at IS NULL`,
    )
    .bind(state, now, workspaceId)
    .run()
}
