import type { WorkspaceRow } from './workspace-row'
import type { Workspace } from '../../src/shared/generated/Workspace'
import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'
import { activeOrgIdPredicate } from '../data/org-access'
import { workspaceNameColumn } from '../data/workspace-name'
import { presentWorkspace } from '../data/workspace-link'
import { requireActiveOrg } from '../data/user-access'
import type { User } from '../../src/shared/api'
import type { SendMessageRequest } from '../../src/shared/messages'

import { workspaceRestoreUntil } from '../../src/shared/workspaces'
import { HttpError } from '../http'
import { leasedImage, type LeasedImage } from './image-leases'
import type { RepositoryLocation } from './repository-locations'

const columns = `w.id, w.number, w.org_id AS orgId, w.repository_id AS repositoryId,
  w.section_id AS sectionId, w.owner_user_id AS ownerUserId,
  u.github_login AS githubLogin, u.display_name AS displayName, u.avatar_url AS avatarUrl,
  ${workspaceNameColumn('w')}, w.branch,
  COALESCE(w.base_branch, (SELECT default_branch FROM repositories WHERE id = w.repository_id AND org_id = w.org_id)) AS baseBranch,
  w.sandbox_id AS sandboxId,
  w.provider_account AS providerAccount, w.state, w.github_summary AS github,
  w.created_at AS createdAt, w.updated_at AS updatedAt, w.archived_at AS archivedAt,
  w.stopped_at AS stoppedAt, w.next_disk_keepalive_at AS nextDiskKeepaliveAt,
  r.agent, r.model, r.effort, r.fast, r.session_id AS sessionId, r.first_turn_id AS firstTurnId`

export async function readWorkspace(
  db: D1Database,
  orgId: string,
  workspaceId: string,
): Promise<WorkspaceRow> {
  const row = await db
    .prepare(
      `SELECT ${columns} FROM workspaces w JOIN users u ON u.id = w.owner_user_id
     JOIN workspace_runtime r ON r.workspace_id = w.id
     JOIN orgs ON orgs.id = w.org_id
     WHERE w.id = ? AND w.org_id = ? AND orgs.deleted_at IS NULL`,
    )
    .bind(workspaceId, orgId)
    .first<WorkspaceRow>()
  if (!row)
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  return row
}

export function workspaceView(row: WorkspaceRow, origin: string): Workspace {
  return presentWorkspace(workspaceRecord(row), {
    origin,
    orgId: row.orgId,
    workspaceId: row.id,
    number: row.number,
  })
}

export function workspaceRecord(row: WorkspaceRow): Omit<Workspace, 'link'> {
  return {
    id: row.id,
    number: row.number,
    orgId: row.orgId,
    repositoryId: row.repositoryId,
    sectionId: row.sectionId,
    owner: {
      id: row.ownerUserId,
      githubLogin: row.githubLogin,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
    },
    name: row.name,
    branch: row.branch,
    choice: {
      agent: row.agent,
      model: row.model,
      effort: row.effort,
      fast: row.fast === 1,
    },
    state: row.state,
    github: row.github,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    restoreUntil: workspaceRestoreUntil(row.archivedAt, row.sandboxId),
  }
}

export async function insertWorkspace(
  db: D1Database,
  input: {
    id: string
    orgId: string
    providerAccount: string
    repositoryId: string
    sectionId?: string
    user: User
    senderUserId?: string
    city: string
    name?: string
    branch: string
    baseBranch?: string
    sessionId: string
    turnId: string
    message: SendMessageRequest
    now: number
    repositoryLocations?: readonly RepositoryLocation[]
  },
): Promise<LeasedImage> {
  if (!input.sectionId) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO sections (id, org_id, name, position, is_default, created_at)
       SELECT ?, ?, 'General', 0, 1, ? WHERE ${activeOrgIdPredicate('?')}`,
      )
      .bind(`general-${input.orgId}`, input.orgId, input.now, input.orgId)
      .run()
  }
  const section = await db
    .prepare(
      `SELECT id FROM sections WHERE org_id = ? AND ${input.sectionId ? 'id = ?' : 'is_default = 1'}`,
    )
    .bind(...(input.sectionId ? [input.orgId, input.sectionId] : [input.orgId]))
    .first<{ id: string }>()
  if (!section)
    throw new HttpError(
      404,
      'section_not_found',
      'The section is not available.',
    )
  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, org_id, repository_id, owner_user_id, section_id,
       name, branch, base_branch, provider_account, state, created_at, updated_at, last_activity_at, position)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?,
         (SELECT COALESCE(MIN(position) - 1, 0) FROM workspaces
          WHERE org_id = ? AND section_id = ? AND archived_at IS NULL AND state != 'archived')
       WHERE ${activeOrgIdPredicate('?')}`,
      )
      .bind(
        input.id,
        input.orgId,
        input.repositoryId,
        input.user.id,
        section.id,
        input.name ?? '',
        input.branch,
        input.baseBranch ?? null,
        input.providerAccount,
        input.now,
        input.now,
        input.now,
        input.orgId,
        section.id,
        input.orgId,
      ),
    db
      .prepare(
        `INSERT INTO workspace_runtime (workspace_id, org_id, created_by_user_id, session_id, first_turn_id, agent, model, effort, fast, first_message_id, repository_locations_json)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)`,
      )
      .bind(
        input.id,
        input.orgId,
        input.senderUserId ?? input.user.id,
        input.sessionId,
        input.turnId,
        input.message.choice.agent,
        input.message.choice.model,
        input.message.choice.effort,
        input.message.choice.fast ? 1 : 0,
        input.message.id,
        input.repositoryLocations
          ? JSON.stringify(input.repositoryLocations)
          : null,
        input.id,
      ),
  ])
  await requireActiveOrg(db, input.orgId)
  return leasedImage(db, input.orgId, input.id)
}

export async function assignSandbox(
  db: D1Database,
  orgId: string,
  workspaceId: string,
  sandboxId: string,
  providerAccount: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE workspaces SET sandbox_id = ?, provider_account = ? WHERE id = ? AND org_id = ?',
    )
    .bind(sandboxId, providerAccount, workspaceId, orgId)
    .run()
}

export async function deleteProvisionalWorkspace(
  db: D1Database,
  orgId: string,
  workspaceId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM workspaces WHERE id = ? AND org_id = ?')
      .bind(workspaceId, orgId),
    db
      .prepare(
        "UPDATE workspace_creation_attempts SET state = 'failed' WHERE workspace_id = ? AND org_id = ?",
      )
      .bind(workspaceId, orgId),
  ])
}

export async function persistLifecycleState(
  db: D1Database,
  input: {
    workspaceId: string
    orgId: string
    state: WorkspaceState
    lastActivityAt: number
    stoppedAt: number | null
    nextDiskKeepaliveAt: number | null
    error: { code: string; message: string } | null
  },
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspaces SET state = ?, last_activity_at = ?, stopped_at = ?,
     next_disk_keepalive_at = ?, last_error_code = ?, last_error_message = ?, updated_at = MAX(updated_at, ?)
     WHERE id = ? AND org_id = ? AND archived_at IS NULL AND state != 'archived'
       AND EXISTS (SELECT 1 FROM orgs WHERE orgs.id = workspaces.org_id AND orgs.deleted_at IS NULL)`,
    )
    .bind(
      input.state,
      input.lastActivityAt,
      input.stoppedAt,
      input.nextDiskKeepaliveAt,
      input.error?.code ?? null,
      input.error?.message ?? null,
      now,
      input.workspaceId,
      input.orgId,
    )
    .run()
}

export async function revokeWorkspacePreviews(
  db: D1Database,
  workspaceId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE preview_hostnames SET revoked_at = ? WHERE workspace_id = ? AND revoked_at IS NULL',
    )
    .bind(now, workspaceId)
    .run()
}

export function workspaceExists(
  db: D1Database,
  orgId: string,
  workspaceId: string,
): Promise<{ id: string } | null> {
  return db
    .prepare('SELECT id FROM workspaces WHERE org_id = ? AND id = ?')
    .bind(orgId, workspaceId)
    .first<{ id: string }>()
}
