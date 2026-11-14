import type { RunnerFileEvent } from '../../src/shared/generated/RunnerFileEvent'
import type { RunnerFileRevisionPart } from '../../src/shared/generated/RunnerFileRevisionPart'
import { isRecord } from '../http'
import { invalidFileResponse } from './errors'
import { natural, parseFileEvent } from './parsers'

function part(value: unknown): RunnerFileRevisionPart {
  if (
    !isRecord(value) ||
    !natural(value.revision) ||
    value.revision === 0 ||
    !natural(value.partNumber) ||
    value.partNumber === 0 ||
    !natural(value.partCount) ||
    value.partCount === 0 ||
    value.partNumber > value.partCount
  )
    throw invalidFileResponse()
  return {
    revision: value.revision,
    partNumber: value.partNumber,
    partCount: value.partCount,
  }
}

export function parseRunnerFileEvent(value: unknown): RunnerFileEvent {
  const event = parseFileEvent(value)
  if (!isRecord(value)) throw invalidFileResponse()
  if (event.type === 'files.unavailable') return event
  if (event.type === 'files.snapshot')
    return { ...event, tree: { ...event.tree, ...part(value.tree) } }
  if (event.type === 'changes.updated')
    return { ...event, changes: { ...event.changes, ...part(value.changes) } }
  if (event.delta.revision === 0) throw invalidFileResponse()
  return event
}
