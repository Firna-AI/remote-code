import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'
import { HttpError } from '../http'

import { workspaceTokenResourcePredicate } from './workspace-token-access'
import { suspendedOrgError } from './org-access'

export interface UserAccess {
  id: string
  suspendedAt: number | null
}

export function githubUserAccess(
  db: D1Database,
  githubId: number,
): Promise<UserAccess | null> {
  return db
    .prepare(
      'SELECT id, suspended_at AS suspendedAt FROM users WHERE github_id = ?',
    )
    .bind(githubId)
    .first<UserAccess>()
}

export async function userSuspended(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const user = await db
    .prepare('SELECT suspended_at AS suspendedAt FROM users WHERE id = ?')
    .bind(userId)
    .first<{ suspendedAt: number | null }>()
  return user?.suspendedAt !== undefined && user.suspendedAt !== null
}

export async function requireActiveUser(
  db: D1Database,
  userId: string,
  orgId?: string,
): Promise<void> {
  await requireActiveAccess(db, orgId, userId)
}

async function requireActiveAccess(
  db: D1Database,
  orgId?: string,
  userId?: string,
  owner = false,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT
    (SELECT suspended_at FROM orgs WHERE id = ?) AS orgSuspendedAt,
    (SELECT suspended_at FROM users WHERE id = ?) AS userSuspendedAt`,
    )
    .bind(orgId ?? null, userId ?? null)
    .first<{ orgSuspendedAt: number | null; userSuspendedAt: number | null }>()
  if (row?.orgSuspendedAt != null) throw suspendedOrgError()
  if (row?.userSuspendedAt != null)
    throw owner ? suspendedWorkspaceOwnerError() : suspendedUserError()
}

export function requireActiveOrg(db: D1Database, orgId: string): Promise<void> {
  return requireActiveAccess(db, orgId)
}

export function suspendedUserError(): HttpError {
  return new HttpError(403, 'user_suspended', 'This account is suspended.')
}

export function suspendedWorkspaceOwnerError(): HttpError {
  return new HttpError(
    403,
    'user_suspended',
    'The workspace owner is suspended. Ask an admin to assign another member.',
  )
}

export async function requireActiveWorkspaceOwner(
  db: D1Database,
  userId: string,
  orgId?: string,
): Promise<void> {
  await requireActiveAccess(db, orgId, userId, true)
}

export interface WorkspaceAccessStopRecord {
  ownerUserId: string
  orgId: string
  sandboxId: string | null
  providerAccount: string
  orgDeletedAt: number | null
  state: WorkspaceState
  ownerSuspended: boolean
  orgSuspended: boolean
  revokedTokenRunning: boolean
  maintenanceAllowed: boolean
}

export async function readWorkspaceAccessStop(
  db: D1Database,
  workspaceId: string,
): Promise<WorkspaceAccessStopRecord | null> {
  const row = await db
    .prepare(
      `SELECT w.owner_user_id AS ownerUserId, w.org_id AS orgId, w.sandbox_id AS sandboxId,
         w.provider_account AS providerAccount,
         o.deleted_at AS orgDeletedAt, w.state,
         CASE WHEN u.suspended_at IS NOT NULL THEN 1 ELSE 0 END AS ownerSuspended,
         CASE WHEN o.suspended_at IS NOT NULL THEN 1 ELSE 0 END AS orgSuspended,
         CASE WHEN t.revoked_at IS NOT NULL AND w.state IN
           ('starting', 'ready', 'working', 'unread', 'input')
           THEN 1 ELSE 0 END AS revokedTokenRunning,
         CASE WHEN w.state = 'stopped' AND w.sandbox_id IS NOT NULL
           AND ${workspaceTokenResourcePredicate} THEN 1 ELSE 0 END AS maintenanceAllowed
       FROM workspaces w JOIN users u ON u.id = w.owner_user_id
       JOIN orgs o ON o.id = w.org_id
       LEFT JOIN workspace_tokens t ON t.workspace_id = w.id
       WHERE w.id = ?`,
    )
    .bind(workspaceId)
    .first<
      Omit<
        WorkspaceAccessStopRecord,
        | 'ownerSuspended'
        | 'orgSuspended'
        | 'revokedTokenRunning'
        | 'maintenanceAllowed'
      > & {
        ownerSuspended: number
        orgSuspended: number
        revokedTokenRunning: number
        maintenanceAllowed: number
      }
    >()
  return row
    ? {
        ...row,
        ownerSuspended: row.ownerSuspended === 1,
        orgSuspended: row.orgSuspended === 1,
        revokedTokenRunning: row.revokedTokenRunning === 1,
        maintenanceAllowed: row.maintenanceAllowed === 1,
      }
    : null
}
