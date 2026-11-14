import type { FileEntry } from '../../src/shared/generated/FileEntry'
import type { RunnerFileEvent } from '../../src/shared/generated/RunnerFileEvent'
import type { FileEvent } from '../../src/shared/files'
import { encrypt } from '../security/crypto'
import { orgEnvironmentContext } from '../lifecycle/settings-data'
import { createRunnerLimitsFixture } from './runner-limits.test-support'
export const grownEntries: readonly FileEntry[] = Array.from(
  { length: 960 },
  (_, index) => ({
    path: `${'a'.repeat(220)}/${'a'.repeat(219)}/file-${index}.txt`,
    displayPath: `${'[redacted]'.repeat(220)}/${'[redacted]'.repeat(219)}/file-${index}.txt`,
    name: `file-${index}.txt`,
    kind: 'file',
    change: null,
  }),
)
export function reportPart(
  kind: 'tree' | 'changes',
  partNumber: number,
): RunnerFileEvent {
  const entries = grownEntries
    .slice((partNumber - 1) * 480, partNumber * 480)
    .map(({ path, name, kind, change }) => ({ path, name, kind, change }))
  const part = { revision: 1, partNumber, partCount: 2 }
  if (kind === 'tree')
    return { type: 'files.snapshot', tree: { ...part, entries } }
  return {
    type: 'changes.updated',
    changes: {
      ...part,
      baseBranch: 'main',
      files: entries.map(({ path }) => ({
        path,
        change: 'modified',
        added: 1,
        removed: 0,
        uncommitted: true,
      })),
      summary: { files: 960, added: 960, removed: 0 },
    },
  }
}
export function completeReport(kind: 'tree' | 'changes'): FileEvent {
  if (kind === 'tree')
    return {
      type: 'files.snapshot',
      tree: { revision: 1, entries: grownEntries },
    }
  return {
    type: 'changes.updated',
    changes: {
      baseBranch: 'main',
      displayBaseBranch: 'm[redacted]in',
      files: grownEntries.map(({ path, displayPath }) => ({
        path,
        displayPath,
        change: 'modified',
        added: 1,
        removed: 0,
        uncommitted: true,
      })),
      summary: { files: 960, added: 960, removed: 0 },
    },
  }
}
export async function createGrownReportsFixture() {
  const fixture = await createRunnerLimitsFixture()
  const ciphertext = await encrypt(
    JSON.stringify({ TOKEN: { value: 'a', secret: true } }),
    orgEnvironmentContext('org'),
    fixture.harness.env.BOAT_KEY_ENCRYPTION_KEY,
  )
  await fixture.harness.env.DB.prepare(
    `INSERT INTO workspace_runtime
    (workspace_id, org_id, created_by_user_id, session_id, first_turn_id, environment_ciphertext, agent, model, effort, first_message_id)
    VALUES ('workspace', 'org', 'sender', 'session', 'turn', ?, 'claude', 'test', 'high', 'unused')`,
  )
    .bind(ciphertext)
    .run()
  return fixture
}
