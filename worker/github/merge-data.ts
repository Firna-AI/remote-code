import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'
import type { GitHubWorkspace } from './contracts'

interface MergeWorkspace extends GitHubWorkspace {
  archivedAt: number | null
  state: WorkspaceState
  orgSuspendedAt: number | null
}

export function mergeWorkspace(
  db: D1Database,
  orgId: string,
  id: string,
  userId: string,
): Promise<MergeWorkspace | null> {
  return db
    .prepare(
      `SELECT w.id, w.org_id AS orgId, w.branch, w.state,
      w.archived_at AS archivedAt, o.suspended_at AS orgSuspendedAt,
      r.github_repository_id AS repositoryId, r.full_name AS fullName,
      r.default_branch AS defaultBranch, w.base_branch AS baseBranch, r.installation_id AS installationId
    FROM workspaces w
    JOIN repositories r ON r.id = w.repository_id AND r.org_id = w.org_id
    JOIN orgs o ON o.id = w.org_id
    JOIN github_installations i ON i.id = r.installation_id
    JOIN org_members m ON m.org_id = w.org_id AND m.user_id = ?
    JOIN users viewer ON viewer.id = m.user_id AND viewer.suspended_at IS NULL
    WHERE w.id = ? AND w.org_id = ? AND o.deleted_at IS NULL
      AND i.suspended_at IS NULL`,
    )
    .bind(userId, id, orgId)
    .first<MergeWorkspace>()
}
