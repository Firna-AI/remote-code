import type { ImageBuild } from '../../src/shared/org-settings'
import { RUNNER_PROTOCOL_VERSION } from '../../src/shared/runner'
import { activeOrgIdPredicate } from '../data/org-access'
import { requireActiveOrg } from '../data/user-access'
import type { BuildJob } from './build-data'
import type { SelectedRepository } from './settings-data'
import type { RepositoryLocation } from './repository-locations'
import type { ImageSoftwareArtifact } from './image-software'
import { serializeSavedScript, type SavedScript } from './saved-script'

export async function finishUnscheduledBuild(
  db: D1Database,
  buildId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE image_build_jobs SET phase = CASE
       WHEN phase = 'create' AND EXISTS (SELECT 1 FROM image_builds
         WHERE id = image_build_jobs.build_id AND sandbox_id IS NULL AND snapshot_name IS NULL)
         THEN 'done'
       WHEN phase = 'allocating' AND EXISTS (SELECT 1 FROM image_builds
         WHERE id = image_build_jobs.build_id AND sandbox_id IS NULL) THEN 'allocating'
       ELSE 'cleanup' END
       WHERE build_id = ? AND phase != 'done'
     AND EXISTS (SELECT 1 FROM image_builds WHERE id = image_build_jobs.build_id
       AND state = 'failed')`,
    )
    .bind(buildId)
    .run()
}

export async function insertBuild(
  db: D1Database,
  input: {
    id: string
    orgId: string
    providerAccount: string
    previousProviderAccount: string
    kind: ImageBuild['kind']
    userId: string | null
    settingsRevision: number
    installScript: SavedScript
    repositories: readonly SelectedRepository[]
    repositoryLocations: readonly RepositoryLocation[]
    previousRepositoryLocations: readonly RepositoryLocation[]
    software: ImageSoftwareArtifact
    softwareVersion?: string
    previousImageName: string | null
    now: number
    nextImageRefreshAt?: number
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO image_builds (id, org_id, kind, state, settings_revision,
       runner_protocol_version, started_by_user_id, started_at, provider_account)
       SELECT ?, ?, ?, 'running', ?, ?, ?, ?, ? WHERE ${activeOrgIdPredicate('?')}`,
      )
      .bind(
        input.id,
        input.orgId,
        input.kind,
        input.settingsRevision,
        RUNNER_PROTOCOL_VERSION,
        input.userId,
        input.now,
        input.providerAccount,
        input.orgId,
      ),
    db
      .prepare(
        `INSERT INTO image_build_jobs (build_id, phase, install_script, repositories_json, software_json, previous_image_name,
          repository_locations_json, previous_repository_locations_json, provider_account, software_image_name)
       SELECT ?, 'create', ?, ?, ?, ?, ?, ?, ?,
         (SELECT snapshot_name FROM software_images
          WHERE provider_account = ? AND version = ? AND state = 'ready'
          ORDER BY started_at DESC, id DESC LIMIT 1)
       WHERE EXISTS (SELECT 1 FROM image_builds WHERE id = ?)`,
      )
      .bind(
        input.id,
        serializeSavedScript(input.installScript),
        JSON.stringify(input.repositories),
        JSON.stringify(input.software),
        input.previousImageName,
        JSON.stringify(input.repositoryLocations),
        JSON.stringify(input.previousRepositoryLocations),
        input.previousProviderAccount,
        input.providerAccount,
        input.softwareVersion ?? null,
        input.id,
      ),
    db
      .prepare(
        `INSERT INTO org_images (org_id, provider_account, next_image_refresh_at)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM image_builds WHERE id = ?)
         ON CONFLICT (org_id, provider_account) DO UPDATE
         SET next_image_refresh_at = COALESCE(excluded.next_image_refresh_at,
           org_images.next_image_refresh_at)`,
      )
      .bind(
        input.orgId,
        input.providerAccount,
        input.nextImageRefreshAt ?? null,
        input.id,
      ),
  ])
  await requireActiveOrg(db, input.orgId)
}

export async function publishBuild(
  db: D1Database,
  job: BuildJob,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO org_images
         (org_id, provider_account, image_name, image_build_id, last_refresh_at, next_image_refresh_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE ${activeOrgIdPredicate('?')}
         ON CONFLICT (org_id, provider_account) DO UPDATE SET
         image_name = excluded.image_name, image_build_id = excluded.image_build_id,
         last_refresh_at = excluded.last_refresh_at,
         next_image_refresh_at = excluded.next_image_refresh_at`,
      )
      .bind(
        job.orgId,
        job.providerAccount,
        job.snapshotName,
        job.buildId,
        now,
        now + 86_400_000,
        job.orgId,
      ),
    db
      .prepare(
        `UPDATE image_builds SET state = 'succeeded', completed_at = ?, error = NULL, provider_retry_json = NULL WHERE id = ? AND ${activeOrgIdPredicate('image_builds.org_id')}`,
      )
      .bind(now, job.buildId),
    db
      .prepare(
        `UPDATE image_build_jobs SET phase = CASE WHEN
          (? IS NULL AND ? = 'build'
            AND EXISTS (SELECT 1 FROM settings WHERE org_id = ? AND revision > ?))
          OR (EXISTS (SELECT 1 FROM repositories r WHERE r.org_id = ? AND r.selected = 1
            AND NOT EXISTS (SELECT 1 FROM json_each(image_build_jobs.repositories_json) repository
              WHERE json_extract(repository.value, '$.id') = r.id))
            AND (SELECT state FROM image_builds WHERE org_id = ? AND kind = 'build'
              ORDER BY started_at DESC, id DESC LIMIT 1) = 'succeeded')
          THEN 'cleanup-build' ELSE 'cleanup' END,
          process_id = NULL WHERE build_id = ? AND EXISTS
          (SELECT 1 FROM image_builds WHERE id = image_build_jobs.build_id AND state = 'succeeded')`,
      )
      .bind(
        job.previousImageName,
        job.kind,
        job.orgId,
        job.settingsRevision,
        job.orgId,
        job.orgId,
        job.buildId,
      ),
  ])
  await requireActiveOrg(db, job.orgId)
}
