import type { AgentListWorkspacesRequest } from '../../src/shared/generated/AgentListWorkspacesRequest'
import type { AgentListWorkspacesResponse } from '../../src/shared/generated/AgentListWorkspacesResponse'
import type { AgentWorkspaceDetail } from '../../src/shared/generated/AgentWorkspaceDetail'
import type { AgentWorkspaceListEntry } from '../../src/shared/generated/AgentWorkspaceListEntry'
import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'

import { workspaceRestoreUntil } from '../../src/shared/workspaces'
import { requireActiveOrg } from '../data/user-access'
import { workspaceLink } from '../data/workspace-link'
import { workspaceNameColumn } from '../data/workspace-name'
import { HttpError } from '../http'

interface WorkspaceRow {
  id: string
  number: number
  name: string | null
  branch: string
  state: WorkspaceState
  ownerId: string
  githubLogin: string
  displayName: string | null
  repositoryId: string
  fullName: string
  defaultBranch: string
  baseBranch: string
  sectionId: string
  sectionName: string
  createdAt: number
  lastActivityAt: number
  archivedAt: number | null
  sandboxId: string | null
}

const source = `SELECT w.id, w.number, ${workspaceNameColumn('w')}, w.branch, w.state,
  u.id AS ownerId, u.github_login AS githubLogin, u.display_name AS displayName,
  r.id AS repositoryId, r.full_name AS fullName, r.default_branch AS defaultBranch,
  COALESCE(w.base_branch, r.default_branch) AS baseBranch,
  s.id AS sectionId, s.name AS sectionName, w.created_at AS createdAt,
  w.updated_at AS lastActivityAt, w.archived_at AS archivedAt, w.sandbox_id AS sandboxId
  FROM workspaces w JOIN users u ON u.id = w.owner_user_id
  JOIN repositories r ON r.id = w.repository_id AND r.org_id = w.org_id
  JOIN sections s ON s.id = w.section_id AND s.org_id = w.org_id
  JOIN orgs o ON o.id = w.org_id WHERE w.org_id = ? AND o.deleted_at IS NULL`

function summary(
  row: WorkspaceRow,
  origin: string,
  orgId: string,
): AgentWorkspaceListEntry {
  return {
    id: row.id,
    number: row.number,
    link: workspaceLink(origin, orgId, row.id),
    name: row.name,
    branch: row.branch,
    state: row.state,
    owner: {
      id: row.ownerId,
      githubLogin: row.githubLogin,
      displayName: row.displayName,
    },
  }
}

export async function listToolWorkspaces(
  db: D1Database,
  orgId: string,
  origin: string,
  input: AgentListWorkspacesRequest,
): Promise<AgentListWorkspacesResponse> {
  const filters: string[] = []
  const values: (string | number)[] = [orgId]
  for (const [column, value] of [
    ['w.owner_user_id', input.ownerId],
    ['w.state', input.state],
    ['w.repository_id', input.repositoryId],
  ] as const) {
    if (value !== undefined) {
      filters.push(`${column} = ?`)
      values.push(value)
    }
  }
  if (input.updatedSince !== undefined) {
    filters.push('w.updated_at >= ?')
    values.push(input.updatedSince)
  }
  if (input.archived !== undefined)
    filters.push(
      input.archived
        ? "(w.archived_at IS NOT NULL OR w.state = 'archived')"
        : "(w.archived_at IS NULL AND w.state != 'archived')",
    )
  const { results } = await db
    .prepare(
      `${source}${filters.length ? ` AND ${filters.join(' AND ')}` : ''}
     ORDER BY w.created_at, w.id LIMIT ? OFFSET ?`,
    )
    .bind(
      ...values,
      input.query !== undefined || input.limit === undefined
        ? -1
        : input.limit + 1,
      input.query !== undefined ? 0 : (input.offset ?? 0),
    )
    .all<WorkspaceRow>()
  const query = input.query?.toLowerCase()
  const matching =
    query === undefined
      ? results
      : results.filter((row) => row.name?.toLowerCase().includes(query))
  const offset = input.query === undefined ? 0 : (input.offset ?? 0)
  const end = input.limit === undefined ? undefined : offset + input.limit
  return {
    workspaces: matching
      .slice(offset, end)
      .map((row) => summary(row, origin, orgId)),
    ...(input.limit !== undefined && {
      hasMore: matching.length > offset + input.limit,
    }),
  }
}

export async function toolWorkspaceDetail(
  db: D1Database,
  orgId: string,
  workspaceId: string,
  origin: string,
): Promise<AgentWorkspaceDetail> {
  await requireActiveOrg(db, orgId)
  const row = await db
    .prepare(`${source} AND w.id = ?`)
    .bind(orgId, workspaceId)
    .first<WorkspaceRow>()
  if (!row)
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  return {
    ...summary(row, origin, orgId),
    repository: {
      id: row.repositoryId,
      fullName: row.fullName,
      defaultBranch: row.defaultBranch,
    },
    baseBranch: row.baseBranch,
    section: { id: row.sectionId, name: row.sectionName },
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    archivedAt: row.archivedAt,
    restoreUntil: workspaceRestoreUntil(row.archivedAt, row.sandboxId),
  }
}
