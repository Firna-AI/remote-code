import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import type { RunnerReportKind } from '../../src/shared/generated/RunnerReportKind'
import type { WorkspaceEvent } from './workspace-events'
import { RUNNER_EVENT_MAX_BYTES } from '../../src/shared/runner'
import type { FakeRunner } from '../test-support/fake-runner'
import { WORKSPACE_ID, type ChatFixture } from './harness.test-support'

export const reportKinds: readonly RunnerReportKind[] = [
  'files.snapshot',
  'changes.updated',
  'start.updated',
  'workspace.title',
  'ports.updated',
]

export function fullReport(
  kind: RunnerReportKind,
  revision = 1,
  partNumber = 1,
  partCount = 1,
): RunnerEvent {
  switch (kind) {
    case 'files.snapshot':
      return {
        type: kind,
        tree: {
          revision,
          partNumber,
          partCount,
          entries: [
            {
              path: `file-${partNumber}`,
              name: `file-${partNumber}`,
              kind: 'file',
              change: null,
            },
          ],
        },
      }
    case 'changes.updated':
      return {
        type: kind,
        changes: {
          revision,
          partNumber,
          partCount,
          baseBranch: 'main',
          files: [
            {
              path: `file-${partNumber}`,
              change: 'modified',
              added: 1,
              removed: 0,
              uncommitted: true,
            },
          ],
          summary: { files: partCount, added: partCount, removed: 0 },
        },
      }
    case 'start.updated':
      return { type: kind, start: { kind: 'create', startedAt: 25, steps: [] } }
    case 'workspace.title':
      return { type: kind, name: `Name ${revision}` }
    case 'ports.updated':
      return {
        type: kind,
        ports: [{ port: 3000, name: 'vite dev', folder: null }],
      }
  }
}

export function oversizedReport(
  kind: RunnerReportKind,
  revision = 1,
  partNumber = 1,
  partCount = 1,
): RunnerEvent {
  return Object.assign(fullReport(kind, revision, partNumber, partCount), {
    discarded: 'x'.repeat(RUNNER_EVENT_MAX_BYTES),
    repairFailed: true,
  })
}

export function refreshCommands(runner: FakeRunner) {
  return runner.commands.filter((command) => command.type === 'report.refresh')
}

export async function workspaceEvents(
  fixture: ChatFixture,
): Promise<WorkspaceEvent[]> {
  return (
    await fixture.chat.store.read(WORKSPACE_ID, (view) => view.history(0))
  ).events.map(({ event }) => event)
}

export async function refusedEvents(fixture: ChatFixture) {
  return (await workspaceEvents(fixture)).filter(
    (event) => event.type === 'runner.event-refused',
  )
}
