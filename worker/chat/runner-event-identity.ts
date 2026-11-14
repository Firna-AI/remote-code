import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import { isRecord } from '../http'

export interface RunnerEventIdentity {
  type: RunnerEvent['type'] | null
  sessionId: string | null
  turnId: string | null
  revision: number | null
  partNumber: number | null
}

/** Refusal decisions use identity fields only, even when the payload is invalid. */
export function readRunnerEventIdentity(value: unknown): RunnerEventIdentity {
  if (!isRecord(value)) {
    return {
      type: null,
      sessionId: null,
      turnId: null,
      revision: null,
      partNumber: null,
    }
  }
  let type: RunnerEventIdentity['type'] = null
  switch (value.type) {
    case 'turn.started':
    case 'turn.thinking':
    case 'assistant.delta':
    case 'assistant.completed':
    case 'tool.updated':
    case 'turn.completed':
    case 'turn.failed':
    case 'runner.ready':
    case 'start.updated':
    case 'workspace.title':
    case 'files.snapshot':
    case 'files.unavailable':
    case 'files.changed':
    case 'changes.updated':
    case 'ports.updated':
      type = value.type
  }
  const report =
    type === 'files.snapshot'
      ? value.tree
      : type === 'changes.updated'
        ? value.changes
        : null
  let revision: number | null = null
  let partNumber: number | null = null
  if (isRecord(report)) {
    if (
      typeof report.revision === 'number' &&
      Number.isSafeInteger(report.revision) &&
      report.revision > 0
    )
      revision = report.revision
    if (
      typeof report.partNumber === 'number' &&
      Number.isSafeInteger(report.partNumber) &&
      report.partNumber > 0
    )
      partNumber = report.partNumber
  }
  return {
    type,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
    turnId: typeof value.turnId === 'string' ? value.turnId : null,
    revision,
    partNumber,
  }
}
