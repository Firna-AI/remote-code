import type { AgentWorkspaceSummary } from '../../src/shared/generated/AgentWorkspaceSummary'

import { requireActiveOrg } from '../data/user-access'
import { workspaceLink } from '../data/workspace-link'
import { workspaceNameColumn } from '../data/workspace-name'
import { HttpError } from '../http'

export async function toolSessionWorkspace(
  db: D1Database,
  orgId: string,
  workspaceId: string,
  origin: string,
): Promise<AgentWorkspaceSummary> {
  await requireActiveOrg(db, orgId)
  const workspace = await db
    .prepare(
      `SELECT w.id, w.number, ${workspaceNameColumn('w')}, w.branch, w.state
     FROM workspaces w JOIN orgs o ON o.id = w.org_id
     WHERE w.id = ? AND w.org_id = ? AND o.deleted_at IS NULL`,
    )
    .bind(workspaceId, orgId)
    .first<Omit<AgentWorkspaceSummary, 'link'>>()
  if (!workspace)
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  return { ...workspace, link: workspaceLink(origin, orgId, workspaceId) }
}
