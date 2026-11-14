import type { Preview } from '../../src/shared/generated/Preview'
import { previewPath } from '../../src/shared/previews'
import type { WorkspaceTarget } from './types'
import { sandboxAccessPredicate } from '../data/sandbox-access'

export interface PreviewRecord extends WorkspaceTarget {
  id: string
  hostname: string
  port: number
  expiresAt: number
}

export function publicPreview(row: PreviewRecord, appOrigin: string): Preview {
  return {
    id: row.id,
    port: row.port,
    url: new URL(previewPath(row.orgId, row.workspaceId, row.id), appOrigin)
      .href,
    expiresAt: row.expiresAt,
  }
}

export async function insertPreview(
  db: D1Database,
  target: WorkspaceTarget,
  row: PreviewRecord,
  userId: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO preview_hostnames (id, hostname, org_id, workspace_id, port, created_at, expires_at,
       listener_sandbox_id, provider_account)
     SELECT ?, ?, w.org_id, w.id, ?, ?, ?, w.sandbox_id, w.provider_account FROM workspaces w
     JOIN org_members m ON m.org_id = w.org_id
     WHERE w.id = ? AND w.org_id = ? AND w.sandbox_id = ? AND w.provider_account = ?
     AND ${sandboxAccessPredicate} AND m.user_id = ?`,
    )
    .bind(
      row.id,
      row.hostname,
      row.port,
      now,
      row.expiresAt,
      target.workspaceId,
      target.orgId,
      target.sandboxId,
      target.providerAccount,
      userId,
    )
    .run()
  return result.meta.changes === 1
}

export async function listPreviews(
  db: D1Database,
  target: WorkspaceTarget,
  now: number,
  appOrigin: string,
): Promise<Preview[]> {
  const { results } = await db
    .prepare(
      `SELECT id, hostname, port, expires_at AS expiresAt FROM preview_hostnames
     WHERE org_id = ? AND workspace_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at, id`,
    )
    .bind(target.orgId, target.workspaceId, now)
    .all<PreviewRecord>()
  return results.map((row) => publicPreview({ ...target, ...row }, appOrigin))
}

export async function previewForLaunch(
  db: D1Database,
  target: WorkspaceTarget,
  id: string,
  now: number,
): Promise<PreviewRecord | null> {
  const row = await db
    .prepare(
      `SELECT p.id, p.hostname, p.port, p.expires_at AS expiresAt FROM preview_hostnames p
     JOIN workspaces w ON w.id = p.workspace_id AND w.org_id = p.org_id
     WHERE p.org_id = ? AND p.workspace_id = ? AND p.id = ?
       AND p.revoked_at IS NULL AND p.expires_at > ? AND ${sandboxAccessPredicate}`,
    )
    .bind(target.orgId, target.workspaceId, id, now)
    .first<PreviewRecord>()
  return row ? { ...target, ...row } : null
}

export async function savePreviewSandbox(
  db: D1Database,
  target: WorkspaceTarget,
): Promise<void> {
  await db
    .prepare(
      `UPDATE preview_hostnames SET listener_sandbox_id = ?, provider_account = ?
       WHERE workspace_id = ? AND org_id = ? AND revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM workspaces w
         WHERE w.id = preview_hostnames.workspace_id
         AND w.sandbox_id = ? AND w.provider_account = ?)`,
    )
    .bind(
      target.sandboxId,
      target.providerAccount,
      target.workspaceId,
      target.orgId,
      target.sandboxId,
      target.providerAccount,
    )
    .run()
}

export async function revokePreview(
  db: D1Database,
  target: WorkspaceTarget,
  id: string,
  now: number,
): Promise<boolean> {
  const result = await db.batch<{ open: number }>([
    db
      .prepare(
        `SELECT CASE WHEN revoked_at IS NULL AND expires_at > ? THEN 1 ELSE 0 END AS open
      FROM preview_hostnames WHERE org_id = ? AND workspace_id = ? AND id = ?`,
      )
      .bind(now, target.orgId, target.workspaceId, id),
    db
      .prepare(
        `UPDATE preview_hostnames SET revoked_at = COALESCE(revoked_at, ?)
      WHERE org_id = ? AND workspace_id = ? AND id = ?`,
      )
      .bind(now, target.orgId, target.workspaceId, id),
  ])
  return result[0].results[0]?.open === 1
}

export async function revokeWorkspacePreviews(
  db: D1Database,
  workspaceId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE preview_hostnames SET revoked_at = COALESCE(revoked_at, ?) WHERE workspace_id = ?',
    )
    .bind(now, workspaceId)
    .run()
}

export async function expirePreviews(
  db: D1Database,
  now: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE preview_hostnames SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at <= ?',
    )
    .bind(now, now)
    .run()
}

export function previewExpiry(
  db: D1Database,
  workspaceId: string,
): Promise<number | null> {
  return db
    .prepare(
      'SELECT MIN(expires_at) AS expiresAt FROM preview_hostnames WHERE workspace_id = ? AND revoked_at IS NULL',
    )
    .bind(workspaceId)
    .first<number>('expiresAt')
}
