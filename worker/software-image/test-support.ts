import { SOFTWARE_RELEASE as SOFTWARE } from '../lifecycle/software-release-test-support'
import { softwareImageName } from '../lifecycle/image-names'
import { TEST_TIME } from '../test-support/harness'
import { softwareVersion } from './version'

export async function seedReadySoftwareImage(
  db: D1Database,
  id = 'software-ready',
  input: { account?: string; version?: string; now?: number } = {},
): Promise<string> {
  const name = softwareImageName(id)
  await db
    .prepare(
      `INSERT INTO software_images
      (id, provider_account, version, software_json, snapshot_name, state, phase, token_digest, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, 'ready', 'done', ?, ?, ?)`,
    )
    .bind(
      id,
      input.account ?? 'boat',
      input.version ?? (await softwareVersion(SOFTWARE)),
      JSON.stringify(SOFTWARE),
      name,
      'a'.repeat(64),
      input.now ?? TEST_TIME,
      input.now ?? TEST_TIME,
    )
    .run()
  return name
}
