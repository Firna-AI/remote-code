import type { RunnerReportKind } from '../../shared/generated/RunnerReportKind'
import type { FileEvent } from '../../shared/files'
import {
  isObject,
  parseItems,
  readArray,
  readCount,
  type JsonObject,
} from './guards'
import { parseChanges } from './parse-changes'
import { parseFileTree, parseTreeDelta } from './parse-tree'

/** A file event of the workspace stream, or null for any other event. */
function parseFileEvent(value: unknown): FileEvent | null {
  if (!isObject(value)) return null
  switch (value.type) {
    case 'files.snapshot': {
      const tree = parseFileTree(value.tree)
      return tree ? { type: 'files.snapshot', tree } : null
    }
    case 'files.changed': {
      const delta = parseTreeDelta(value.delta)
      return delta ? { type: 'files.changed', delta } : null
    }
    case 'files.unavailable':
      return { type: 'files.unavailable' }
    case 'changes.updated': {
      const changes = parseChanges(value.changes)
      return changes ? { type: 'changes.updated', changes } : null
    }
    default:
      return null
  }
}

/** A full report of a file list, which the workspace can ask for again. */
export type FileReportKind = Extract<
  RunnerReportKind,
  'files.snapshot' | 'changes.updated'
>

/**
 * A failed repair of a file list. The workspace refused an update, asked
 * the runner for a fresh full report, and refused that report too. Only the
 * marker of the refused fresh report says `repairFailed`, so the first loss
 * gives no failed repair. A file list belongs to no session, so a marker
 * with a session is never a failed repair of a file list.
 */
interface FailedFileRepair {
  report: FileReportKind
  /** When the workspace refused the fresh report, in Unix milliseconds. */
  at: number
}

function parseFailedRepair(envelope: JsonObject): FailedFileRepair | null {
  const event = envelope.event
  if (!isObject(event) || event.type !== 'runner.event-refused') return null
  const at = readCount(envelope, 'occurredAt')
  if (event.repairFailed !== true || event.sessionId !== null) return null
  if (at === null) return null
  const report = event.runnerEventType
  return report === 'files.snapshot' || report === 'changes.updated'
    ? { report, at }
    : null
}

/**
 * One numbered event of the workspace. Every event keeps its number, so the
 * reader can find duplicates and gaps. Only file events keep their content,
 * and a marker keeps only the failed repair of a file list.
 */
export interface StreamEnvelope {
  eventNumber: number
  event: FileEvent | null
  failedRepair: FailedFileRepair | null
}

export type StreamMessage =
  | {
      type: 'history'
      envelopes: StreamEnvelope[]
      /** All pages of one replay together hold the state through this number. */
      throughEventNumber: number
      /** Where the next page of the replay starts, or null on the final page. */
      nextAfterEventNumber: number | null
    }
  | { type: 'event'; envelope: StreamEnvelope }

function parseEnvelope(value: unknown): StreamEnvelope | null {
  if (!isObject(value)) return null
  const eventNumber = readCount(value, 'eventNumber')
  if (eventNumber === null || eventNumber < 1) return null
  return {
    eventNumber,
    event: parseFileEvent(value.event),
    failedRepair: parseFailedRepair(value),
  }
}

/** A message of the workspace event stream, from its JSON value. */
export function parseStreamMessage(value: unknown): StreamMessage | null {
  if (!isObject(value)) return null
  if (value.type === 'event') {
    const envelope = parseEnvelope(value.envelope)
    return envelope ? { type: 'event', envelope } : null
  }
  if (value.type !== 'history' || !isObject(value.history)) return null
  const events = readArray(value.history, 'events')
  const through = readCount(value.history, 'throughEventNumber')
  if (events === null || through === null) return null
  const next =
    value.history.hasMore === true
      ? readCount(value.history, 'nextAfterEventNumber')
      : null
  if (value.history.hasMore === true && next === null) return null
  const envelopes = parseItems(events, parseEnvelope).sort(
    (left, right) => left.eventNumber - right.eventNumber,
  )
  return {
    type: 'history',
    envelopes,
    throughEventNumber: through,
    nextAfterEventNumber: next,
  }
}
