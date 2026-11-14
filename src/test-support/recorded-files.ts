import type { ChangesResponse } from '../shared/generated/ChangesResponse'
import type { RunnerFileEvent } from '../shared/generated/RunnerFileEvent'
import type { RunnerFileResponse } from '../shared/generated/RunnerFileResponse'
import type { PathState } from '../../docs/mockups/src/fixtures/maskedFiles'
import type { WorkspaceEventEnvelope } from '../shared/events'
import type { FileEvent } from '../shared/files'
import { FAKE_IDS, FAKE_TIME } from './fixtures/core'
import { toolFixtures } from './fixtures/tools'

const data = toolFixtures()
const changed: ChangesResponse = {
  ...data.changes,
  unpushedCommits: 2,
  files: [
    ...data.changes.files.map((file) =>
      file.path === 'README.md'
        ? {
            ...file,
            path: 'docs/README.md',
            previousPath: 'README.md',
            change: 'renamed' as const,
          }
        : file,
    ),
    {
      path: 'notes.txt',
      change: 'untracked',
      added: 3,
      removed: 0,
      uncommitted: true,
    },
    {
      path: '.env.example',
      change: 'deleted',
      added: 0,
      removed: 2,
      uncommitted: true,
    },
  ],
  summary: { files: 7, added: 161, removed: 50 },
}

/** Browser events contain the joined tree and changes reports. */
const browserFileEvents: readonly FileEvent[] = [
  { type: 'files.snapshot', tree: data.files },
  { type: 'changes.updated', changes: data.changes },
  {
    type: 'files.changed',
    delta: {
      revision: 2,
      changes: [
        {
          operation: 'upsert',
          entry: {
            path: 'notes.txt',
            name: 'notes.txt',
            kind: 'file',
            change: 'untracked',
          },
        },
        {
          operation: 'upsert',
          entry: {
            path: 'docs',
            name: 'docs',
            kind: 'directory',
            change: null,
          },
        },
        {
          operation: 'move',
          previousPath: 'README.md',
          entry: {
            path: 'docs/README.md',
            name: 'README.md',
            kind: 'file',
            change: 'renamed',
          },
        },
        { operation: 'remove', path: '.env.example' },
      ],
    },
  },
  { type: 'changes.updated', changes: changed },
]

/** Complete reports for readers that do not yet join runner parts. */
export const recordedRunnerFileEvents: readonly RunnerFileEvent[] =
  browserFileEvents.map((event): RunnerFileEvent => {
    if (event.type === 'files.changed' || event.type === 'files.unavailable')
      return event
    if (event.type === 'files.snapshot')
      return {
        type: event.type,
        tree: { ...event.tree, partNumber: 1, partCount: 1 },
      }
    return {
      type: event.type,
      changes: {
        ...event.changes,
        revision: event.changes === changed ? 2 : 1,
        partNumber: 1,
        partCount: 1,
      },
    }
  })

/** @public Multipart reports for the fake endpoint and future workspace joining. */
export const recordedMultipartRunnerFileEvents: readonly RunnerFileEvent[] =
  recordedRunnerFileEvents.flatMap((event): readonly RunnerFileEvent[] => {
    if (event.type === 'files.unavailable') return [event]
    if (event.type === 'files.changed') {
      return [0, 1].map((index) => ({
        type: 'files.changed',
        delta: {
          revision: event.delta.revision + index,
          changes:
            index === 0
              ? event.delta.changes.slice(0, 3)
              : event.delta.changes.slice(3),
        },
      }))
    }
    if (event.type === 'files.snapshot') {
      return [0, 1].map((index) => ({
        type: 'files.snapshot',
        tree: {
          ...event.tree,
          entries:
            index === 0
              ? event.tree.entries.slice(0, 4)
              : event.tree.entries.slice(4),
          partNumber: index + 1,
          partCount: 2,
        },
      }))
    }
    return [0, 1].map((index) => ({
      type: 'changes.updated',
      changes: {
        ...event.changes,
        files:
          index === 0
            ? event.changes.files.slice(0, 2)
            : event.changes.files.slice(2),
        partNumber: index + 1,
        partCount: 2,
      },
    }))
  })

/**
 * The browser events with the two masked files of the mockups: the masked
 * tree in the full report, and the masked files in each changes report.
 */
function maskedBrowserFileEvents(): readonly FileEvent[] {
  const masked = toolFixtures('ready-to-merge', 'masked')
  const extra = masked.changes.files.filter(
    (file) => file.displayPath !== undefined,
  )
  const sum = (key: 'added' | 'removed') =>
    extra.reduce((total, file) => total + file[key], 0)
  return browserFileEvents.map((event): FileEvent => {
    if (event.type === 'files.snapshot') {
      return { ...event, tree: masked.files }
    }
    if (event.type !== 'changes.updated') return event
    const { summary } = event.changes
    return {
      ...event,
      changes: {
        ...event.changes,
        files: [...event.changes.files, ...extra],
        summary: {
          files: summary.files + extra.length,
          added: summary.added + sum('added'),
          removed: summary.removed + sum('removed'),
        },
      },
    }
  })
}

export function recordedFileEvents(
  workspaceId: string = FAKE_IDS.workspace,
  firstEventNumber = 1,
  paths: PathState = 'plain',
): readonly WorkspaceEventEnvelope[] {
  const events =
    paths === 'masked' ? maskedBrowserFileEvents() : browserFileEvents
  return events.map((event, index) => ({
    workspaceId,
    eventNumber: firstEventNumber + index,
    occurredAt: FAKE_TIME + index * 1_000,
    event: structuredClone(event),
  }))
}

export const recordedFileResponses: readonly RunnerFileResponse[] = [
  {
    type: 'file.read.result',
    requestId: 'read-1',
    result: { ok: true, file: data.content },
  },
  {
    type: 'file.diff.result',
    requestId: 'diff-1',
    result: { ok: true, diff: data.diff },
  },
  {
    type: 'file.read.result',
    requestId: 'read-limit',
    result: {
      ok: false,
      error: {
        code: 'file_too_large',
        message: 'The file is too large to open.',
        sizeBytes: data.content.sizeBytes,
        limitBytes: 16,
      },
    },
  },
]
