import type { RunnerReportKind } from '../shared/generated/RunnerReportKind'
import { detectedServers } from '../../docs/mockups/src/fixtures/previews'
import type { RunnerEventRefused } from '../shared/chat-events'
import type { WorkspaceEvent, WorkspaceEventEnvelope } from '../shared/events'
import type { FakeWorkspaceEvents } from './fake-events'
import { FAKE_IDS, FAKE_TIME } from './fixtures/core'
import { toolFixtures } from './fixtures/tools'

/**
 * The marker of a refused update that belongs to no session.
 * After the first loss of a kind, the workspace asks the runner for a fresh
 * full report, and the browser shows nothing. `repairFailed` marks the
 * refused fresh report: the repair failed, and a notice shows.
 */
export function refusedReport(
  kind: RunnerReportKind,
  repairFailed: boolean,
  runnerEventNumber = 1,
): RunnerEventRefused {
  return {
    type: 'runner.event-refused',
    streamId: 'recorded-stream-1',
    runnerEventNumber,
    runnerEventType: kind,
    reason: 'too_large',
    sessionId: null,
    turnId: null,
    ...(repairFailed ? { repairFailed: true } : {}),
  }
}

/** A refused tree update. It starts a repair of the file tree. */
export function refusedTreeUpdate(runnerEventNumber = 1): RunnerEventRefused {
  return {
    ...refusedReport('files.snapshot', false, runnerEventNumber),
    runnerEventType: 'files.changed',
  }
}

/** A complete report of each kind, as the workspace stores it for browsers. */
export function fullReport(kind: RunnerReportKind): WorkspaceEvent {
  const data = toolFixtures()
  switch (kind) {
    case 'files.snapshot':
      return { type: kind, tree: data.files }
    case 'changes.updated':
      return { type: kind, changes: data.changes }
    case 'start.updated':
      return {
        type: kind,
        start: {
          kind: 'resume',
          startedAt: FAKE_TIME - 3_000,
          steps: [
            {
              id: 'restore',
              label: 'Resuming with your files as you left them',
              state: 'completed',
              startedAt: FAKE_TIME - 3_000,
              completedAt: FAKE_TIME - 1_000,
            },
          ],
        },
      }
    case 'workspace.title':
      return { type: kind, name: 'Checkout address autocomplete' }
    case 'ports.updated':
      return { type: kind, ports: detectedServers }
  }
}

/** The envelope that follows the last event of the fake workspace stream. */
export function nextEnvelope(
  events: FakeWorkspaceEvents,
  event: WorkspaceEvent,
  occurredAt: number,
): WorkspaceEventEnvelope {
  // The filter keeps no event, so the call copies no history.
  const last = events.history(Number.MAX_SAFE_INTEGER).throughEventNumber
  return {
    workspaceId: FAKE_IDS.workspace,
    eventNumber: last + 1,
    occurredAt,
    event,
  }
}

/** A tree update that adds one untracked file at this tree revision. */
export function treeUpdate(revision: number): WorkspaceEvent {
  const path = `notes-${revision}.md`
  return {
    type: 'files.changed',
    delta: {
      revision,
      changes: [
        {
          operation: 'upsert',
          entry: { path, name: path, kind: 'file', change: 'untracked' },
        },
      ],
    },
  }
}

/** The first loss of each kind, which asks for a fresh full report. */
export function firstLoss(kind: RunnerReportKind): RunnerEventRefused {
  return kind === 'files.snapshot'
    ? refusedTreeUpdate()
    : refusedReport(kind, false)
}

/** How long ago each stored repair failed, as the mockups draw the ages. */
const minutesAgo: Readonly<Record<RunnerReportKind, number>> = {
  'workspace.title': 2,
  'start.updated': 5,
  'files.snapshot': 3,
  'changes.updated': 4,
  'ports.updated': 3,
}

/**
 * Adds a failed repair of each kind to the stored history, before `now`:
 * the first loss, then the loss of the fresh full report a minute later.
 */
export function storeFailedRepairs(
  events: FakeWorkspaceEvents,
  kinds: readonly RunnerReportKind[],
  now: number,
): void {
  for (const kind of kinds) {
    const failedAt = now - minutesAgo[kind] * 60_000
    events.emit(nextEnvelope(events, firstLoss(kind), failedAt - 60_000))
    events.emit(nextEnvelope(events, refusedReport(kind, true, 2), failedAt))
  }
}
