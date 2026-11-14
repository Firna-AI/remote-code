import type { SoftwareRelease } from '../lifecycle/software-release'
import { softwareImageName } from '../lifecycle/image-names'
import type { SoftwareImage } from './types'

const columns = `id, provider_account AS providerAccount, version, software_json AS softwareJson,
  snapshot_name AS snapshotName, snapshot_recorded AS snapshotRecorded, state, phase, revision,
  sandbox_id AS sandboxId, process_id AS processId, stdout_offset AS stdoutOffset,
  stderr_offset AS stderrOffset, output, error, token_digest AS tokenDigest,
  started_at AS startedAt, completed_at AS completedAt`

export function readSoftwareImage(
  db: D1Database,
  id: string,
): Promise<SoftwareImage | null> {
  return db
    .prepare(`SELECT ${columns} FROM software_images WHERE id = ?`)
    .bind(id)
    .first<SoftwareImage>()
}

export function latestSoftwareImage(
  db: D1Database,
  account: string,
  version: string,
): Promise<SoftwareImage | null> {
  return db
    .prepare(
      `SELECT ${columns} FROM software_images
    WHERE provider_account = ? AND version = ? AND state != 'deleting'
    ORDER BY CASE state WHEN 'ready' THEN 0 ELSE 1 END, started_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(account, version)
    .first<SoftwareImage>()
}

export async function softwareImages(
  db: D1Database,
  account: string,
): Promise<SoftwareImage[]> {
  return (
    await db
      .prepare(
        `SELECT ${columns} FROM software_images
    WHERE provider_account = ? ORDER BY started_at DESC, rowid DESC`,
      )
      .bind(account)
      .all<SoftwareImage>()
  ).results
}

export async function insertSoftwareImage(
  db: D1Database,
  input: {
    id: string
    account: string
    version: string
    artifact: SoftwareRelease
    tokenDigest: string
    now: number
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO software_images
    (id, provider_account, version, software_json, snapshot_name, state, phase, token_digest, started_at)
    SELECT ?, ?, ?, ?, ?, 'building', 'create', ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM software_images WHERE provider_account = ? AND
      (state = 'building' OR (version = ? AND (state = 'ready' OR (state = 'failed' AND token_digest = ?)))))
    ON CONFLICT DO NOTHING`,
    )
    .bind(
      input.id,
      input.account,
      input.version,
      JSON.stringify(input.artifact),
      softwareImageName(input.id),
      input.tokenDigest,
      input.now,
      input.account,
      input.version,
      input.tokenDigest,
    )
    .run()
}

type Progress = Partial<
  Pick<
    SoftwareImage,
    | 'phase'
    | 'state'
    | 'sandboxId'
    | 'processId'
    | 'stdoutOffset'
    | 'stderrOffset'
    | 'output'
    | 'error'
    | 'completedAt'
    | 'snapshotRecorded'
  >
>

/** Phase and revision fence stale provider replies and competing output polls. */
export async function saveSoftwareImage(
  db: D1Database,
  before: SoftwareImage,
  changes: Progress,
): Promise<boolean> {
  const next = { ...before, ...changes }
  const result = await db
    .prepare(
      `UPDATE software_images SET phase = ?, state = ?, sandbox_id = ?,
    process_id = ?, stdout_offset = ?, stderr_offset = ?, output = ?, error = ?,
    completed_at = ?, snapshot_recorded = ?, revision = revision + 1
    WHERE id = ? AND state = ? AND phase = ? AND revision = ?`,
    )
    .bind(
      next.phase,
      next.state,
      next.sandboxId,
      next.processId,
      next.stdoutOffset,
      next.stderrOffset,
      next.output,
      next.error,
      next.completedAt,
      next.snapshotRecorded,
      before.id,
      before.state,
      before.phase,
      before.revision,
    )
    .run()
  return result.meta.changes === 1
}

export async function claimSoftwareImageDeletion(
  db: D1Database,
  image: SoftwareImage,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE software_images SET state = 'deleting', revision = revision + 1
    WHERE id = ? AND provider_account = ? AND state = 'ready' AND phase = 'done'
    AND NOT EXISTS (SELECT 1 FROM image_build_jobs j JOIN image_builds b ON b.id = j.build_id
      WHERE j.software_image_name = software_images.snapshot_name
      AND b.provider_account = software_images.provider_account AND j.phase != 'done')`,
    )
    .bind(image.id, image.providerAccount)
    .run()
  return result.meta.changes === 1
}

export async function deleteSoftwareImageRecord(
  db: D1Database,
  image: SoftwareImage,
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM software_images WHERE id = ? AND state = 'deleting' AND revision = ?",
    )
    .bind(image.id, image.revision)
    .run()
}
