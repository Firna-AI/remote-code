import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import type { StartStep } from '../../src/shared/generated/StartStep'
import { HttpError } from '../http'
import { parseRunnerFileEvent } from '../files/runner-input'
import { array } from './agent-events'
import { identifier, invalidInput, number, record, string } from './inputs'
import { parsePortReport } from './port-reports'

function startStep(value: unknown): StartStep {
  const input = record(value)
  if (
    input.state !== 'running' &&
    input.state !== 'completed' &&
    input.state !== 'failed'
  )
    return invalidInput()
  return {
    id: identifier(input.id),
    label: string(input.label),
    state: input.state,
    startedAt: number(input.startedAt),
    completedAt: input.completedAt === null ? null : number(input.completedAt),
  }
}

/** These events share numbering with chat. Their feature owners keep projections. */
export function parseOtherEvent(value: unknown): RunnerEvent | null {
  const input = record(value)
  switch (input.type) {
    case 'runner.ready':
      return { type: input.type }
    case 'workspace.title':
      return { type: input.type, name: string(input.name) }
    case 'ports.updated':
      return parsePortReport(input)
    case 'start.updated': {
      const start = record(input.start)
      if (start.kind !== 'create' && start.kind !== 'resume')
        return invalidInput()
      return {
        type: input.type,
        start: {
          kind: start.kind,
          startedAt: number(start.startedAt),
          steps: array(start.steps, startStep),
        },
      }
    }
    case 'files.snapshot':
    case 'files.unavailable':
    case 'files.changed':
    case 'changes.updated':
      try {
        return parseRunnerFileEvent(value)
      } catch (error) {
        if (error instanceof HttpError && error.code === 'file_unavailable')
          return invalidInput()
        throw error
      }
    default:
      return null
  }
}
