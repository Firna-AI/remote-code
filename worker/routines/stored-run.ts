import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { RoutineRunTrigger } from '../../src/shared/routines'
import { choice } from '../chat/inputs'
import { isRecord } from '../http'
import { invalidRoutineInput } from './errors'
import { parseRoutineTriggers } from './triggers'

export function readRunChoice(json: string | null): AgentChoice | null {
  if (json === null) return null
  const value: unknown = JSON.parse(json)
  return choice(value)
}

export function readRunTrigger(json: string): RoutineRunTrigger {
  const value: unknown = JSON.parse(json)
  if (!isRecord(value)) throw invalidRoutineInput()
  if (value.kind === 'run-now') return { kind: 'run-now' }
  if (value.kind === 'schedule' && typeof value.scheduledAt === 'number') {
    const schedule = value.schedule
    if (
      schedule === 'hourly' ||
      schedule === 'daily' ||
      schedule === 'weekdays' ||
      schedule === 'weekly' ||
      schedule === 'custom'
    )
      return { kind: 'schedule', schedule, scheduledAt: value.scheduledAt }
  }
  if (value.kind === 'pull-request') {
    const [event] = parseRoutineTriggers([
      { kind: value.kind, event: value.event },
    ])
    if (
      event.kind === 'pull-request' &&
      typeof value.number === 'number' &&
      typeof value.url === 'string' &&
      typeof value.headBranch === 'string' &&
      typeof value.headSha === 'string' &&
      typeof value.baseBranch === 'string'
    )
      return {
        kind: 'pull-request',
        event: event.event,
        number: value.number,
        url: value.url,
        headBranch: value.headBranch,
        headSha: value.headSha,
        baseBranch: value.baseBranch,
        ...(typeof value.skipLogin === 'string'
          ? { skipLogin: value.skipLogin }
          : {}),
      }
  }
  throw invalidRoutineInput()
}
