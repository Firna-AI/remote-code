import type { AgentModel } from '../../src/shared/generated/AgentModel'
import { SOFTWARE } from '../lifecycle/backend-test-support'
import { seedPublishedImage } from '../lifecycle/published-image-test-support'
import type { SelectedRepository } from '../lifecycle/settings-data'
import { TEST_TIME } from '../test-support/harness'

export const TOOL_MODELS: readonly AgentModel[] = [
  {
    agent: 'codex',
    model: 'model-z',
    label: 'Model Z',
    efforts: ['high', 'low'],
    fast: false,
  },
  {
    agent: 'claude',
    model: 'model-a',
    label: 'Model A',
    efforts: ['max'],
    fast: false,
  },
]

export async function publishToolImage(
  db: D1Database,
  orgId = 'org-a',
  buildId = 'tools-image',
  repositories: readonly SelectedRepository[] = [
    { id: 'repo-a', orgId, fullName: 'example/alpha', defaultBranch: 'main' },
  ],
) {
  await db
    .prepare(
      'INSERT OR IGNORE INTO settings (org_id, updated_at) VALUES (?, ?)',
    )
    .bind(orgId, TEST_TIME)
    .run()
  await seedPublishedImage(db, {
    orgId,
    buildId,
    imageName: `${buildId}-snapshot`,
    repositories,
    software: SOFTWARE,
    now: TEST_TIME,
  })
}
