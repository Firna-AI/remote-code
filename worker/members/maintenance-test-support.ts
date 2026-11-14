import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'

import { TEST_TIME, type TestHarness } from '../test-support/harness'
import type {
  DeletedOrgMaintenance,
  RestoreOrgMaintenance,
} from './maintenance-contract'
import type { MembersClient } from './members-test-support'

export const DAY_MS = 86400000
export const TEST_RETENTION_INTERVAL_MS = 14 * DAY_MS - 3600000

export async function maintainDisksForTests(input: DeletedOrgMaintenance) {
  for (const disk of input.workspaces) {
    const next =
      disk.nextKeepaliveAt ?? disk.stoppedAt + TEST_RETENTION_INTERVAL_MS
    await input.retention.schedule(disk.workspaceId, next)
    if (input.mode === 'retention' && next <= input.now) {
      const result = await input.retention.restart(disk.workspaceId, 60)
      await input.retention.schedule(
        disk.workspaceId,
        result.stoppedAt + TEST_RETENTION_INTERVAL_MS,
      )
    }
  }
}

export function lifecycleFixture(client: MembersClient) {
  const maintenance: DeletedOrgMaintenance[] = []
  const restored: RestoreOrgMaintenance[] = []
  const maintainDeletedOrg = async (input: DeletedOrgMaintenance) => {
    maintenance.push(input)
    await maintainDisksForTests(input)
  }
  const restoreOrgMaintenance = async (input: RestoreOrgMaintenance) => {
    restored.push(input)
  }
  Object.assign(client.hooks, { maintainDeletedOrg, restoreOrgMaintenance })
  return { maintenance, restored, maintainDeletedOrg, restoreOrgMaintenance }
}

export async function stopWorkspace(
  harness: TestHarness,
  id: string,
  daysAgo: number,
) {
  const stoppedAt = TEST_TIME - daysAgo * DAY_MS
  await harness.env.DB.prepare(
    "UPDATE workspaces SET state = 'stopped', stopped_at = ?, next_disk_keepalive_at = ? WHERE id = ?",
  )
    .bind(stoppedAt, stoppedAt + TEST_RETENTION_INTERVAL_MS, id)
    .run()
}

export function readDisk(harness: TestHarness, id = 'workspace-one') {
  return harness.env.DB.prepare(
    'SELECT stopped_at AS stoppedAt, next_disk_keepalive_at AS nextKeepaliveAt, state FROM workspaces WHERE id = ?',
  )
    .bind(id)
    .first<{
      stoppedAt: number
      nextKeepaliveAt: number | null
      state: WorkspaceState
    }>()
}
