import type { Agent } from '../../shared/generated/Agent'
import type {
  RoutinePullRequestEvent,
  RoutineRun,
  RoutineRunsResponse,
  RoutineRunTrigger,
  RoutineSchedule,
} from '../../shared/routines'
import {
  choice,
  count,
  items,
  maybeNested,
  maybeText,
  nested,
  record,
  text,
} from './parse'
import { AGENTS, readSender } from './read-core'
import { WORKSPACE_STATES } from './read-workspaces'

export const SCHEDULES = [
  'hourly',
  'daily',
  'weekdays',
  'weekly',
  'custom',
] as const satisfies readonly RoutineSchedule['kind'][]
export const EVENTS = [
  'opened',
  'pushed',
  'merged',
] as const satisfies readonly RoutinePullRequestEvent[]
const RUN_STATES = [
  ...WORKSPACE_STATES,
  'queued',
  'failed',
  'skipped',
] as const satisfies readonly RoutineRun['state'][]

function readRunTrigger(value: unknown): RoutineRunTrigger {
  const trigger = record(value, 'run trigger')
  const kind = choice(trigger, 'kind', ['schedule', 'run-now', 'pull-request'])
  switch (kind) {
    case 'schedule':
      return {
        kind,
        schedule: choice(trigger, 'schedule', SCHEDULES),
        scheduledAt: count(trigger, 'scheduledAt'),
      }
    case 'run-now':
      return { kind }
    case 'pull-request': {
      // The account that a skip names. Older runs and other runs have none.
      const skipLogin = maybeText(trigger, 'skipLogin')
      return {
        kind,
        event: choice(trigger, 'event', EVENTS),
        number: count(trigger, 'number'),
        url: text(trigger, 'url'),
        headBranch: text(trigger, 'headBranch'),
        headSha: text(trigger, 'headSha'),
        baseBranch: text(trigger, 'baseBranch'),
        ...(skipLogin === null ? {} : { skipLogin }),
      }
    }
  }
}

function readAgent(value: unknown): Agent {
  return choice({ agent: value }, 'agent', AGENTS)
}

/**
 * A run with the agent and the owner that it ran with. A run from before
 * the Worker kept them has null in their place.
 */
export function readRun(value: unknown): RoutineRun {
  const run = record(value, 'run')
  return {
    id: text(run, 'id'),
    routineId: text(run, 'routineId'),
    orgId: text(run, 'orgId'),
    agent: maybeNested(run, 'agent', readAgent),
    owner: maybeNested(run, 'owner', readSender),
    trigger: nested(run, 'trigger', readRunTrigger),
    state: choice(run, 'state', RUN_STATES),
    workspaceId: maybeText(run, 'workspaceId'),
    error: maybeNested(run, 'error', (item) => {
      const error = record(item, 'error')
      return { code: text(error, 'code'), message: text(error, 'message') }
    }),
    createdAt: count(run, 'createdAt'),
    updatedAt: count(run, 'updatedAt'),
  }
}

/** The run that Run now started. */
export function readRoutineRunResponse(value: unknown): RoutineRun {
  return nested(record(value, 'run response'), 'run', readRun)
}

/** The newest runs of a routine, or an older page, with the cursor of the next. */
export function readRoutineRunsResponse(value: unknown): RoutineRunsResponse {
  const body = record(value, 'runs')
  return {
    runs: items(body, 'runs', readRun),
    nextCursor: maybeText(body, 'nextCursor'),
  }
}
