import type { MessageSender } from '../../shared/generated/MessageSender'
import { routineRows } from '../../../docs/mockups/src/fixtures/routineRows'
import type { RunState } from '../../../docs/mockups/src/fixtures/routineRuns'
import {
  offAfterFailedRuns,
  routines as mockupRoutines,
  type Routine as MockupRoutine,
} from '../../../docs/mockups/src/fixtures/routines'
import type {
  Routine,
  RoutineInactiveReason,
  RoutineRun,
  RoutineRunTrigger,
  RoutinesResponse,
} from '../../shared/routines'
import { FAKE_IDS, FAKE_TIME, fakeUsers } from './core'
import { listRuns, pullRequestTrigger, runListOf, timeOf } from './routine-runs'
import { fakeAccount, storedTrigger } from './routine-triggers'

const day = 86_400_000

function sender(routine: MockupRoutine): MessageSender {
  const user = fakeUsers.find((item) => item.id === routine.owner.key)
  if (!user) throw new Error(`Unknown owner: ${routine.owner.key}`)
  return {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }
}

/** Why the app turned the routine off, or null for an active routine. */
function inactiveReason(routine: MockupRoutine): RoutineInactiveReason | null {
  if (routine.active) return null
  if (offAfterFailedRuns(routine)) return 'failed_runs'
  if (routine.movedFrom !== undefined) return 'owner_left'
  return null
}

/** What started a run: the first trigger of its routine. */
function runTrigger(routine: MockupRoutine, at: number): RoutineRunTrigger {
  const [first] = routine.triggers
  if (!first) return { kind: 'run-now' }
  if (first.kind !== 'pull-request') {
    return { kind: 'schedule', schedule: first.kind, scheduledAt: at }
  }
  return pullRequestTrigger(routine.repository, first.event, 482)
}

/**
 * The last run of a row. A failed run has the cause of a missing agent
 * login and no workspace, as the mockups draw it.
 */
function lastRun(
  routine: MockupRoutine,
  run: { state: RunState; when: string },
  orgId: string,
): RoutineRun {
  const at = timeOf(run.when)
  const workspace = !['queued', 'failed', 'skipped'].includes(run.state)
  return {
    id: `${routine.key}-last`,
    routineId: routine.key,
    orgId,
    agent: routine.choice.agent,
    owner: sender(routine),
    trigger: runTrigger(routine, at),
    state: run.state,
    workspaceId: workspace ? `${routine.key}-run` : null,
    error:
      run.state === 'failed'
        ? {
            code: 'agent_login_required',
            message: 'Connect Claude to run this routine.',
          }
        : null,
    createdAt: at,
    updatedAt: at,
  }
}

function record(routine: MockupRoutine, index: number, orgId: string): Routine {
  const createdAt = FAKE_TIME - (30 + index) * day
  const triggers = routine.triggers.map((item) =>
    storedTrigger(item, fakeAccount),
  )
  const scheduled = triggers.some((item) => item.kind !== 'pull-request')
  return {
    id: routine.key,
    orgId,
    owner: sender(routine),
    movedFrom: routine.movedFrom ?? null,
    name: routine.name,
    repositoryId: routine.repository,
    sectionId: routine.section,
    prompt: routine.prompt,
    choice: { ...routine.choice, fast: routine.choice.fast ?? false },
    active: routine.active,
    inactiveReason: inactiveReason(routine),
    failedRunsInARow: routine.failedRunsInARow ?? 0,
    timeZone: routine.timeZone,
    triggers,
    nextRunAt: routine.active && scheduled ? FAKE_TIME + 3_600_000 : null,
    createdAt,
    updatedAt: createdAt,
  }
}

/**
 * The routines of Acme as the mockups list them, newest first, as the
 * Worker sorts them. `list` is the reply of the list route, with the last
 * run of each routine that the Routines page of the mockups shows.
 * `routines` and `runs` are the records that the test fake and the dev
 * fake serve: each routine has the runs that its page in the mockups
 * lists, or else its last run. `created` is the reply of a create.
 */
export function routineFixtures(orgId: string = FAKE_IDS.org) {
  const routines: Routine[] = routineRows.map((row, index) =>
    record(row.routine, index, orgId),
  )
  const lastRuns: RoutineRun[] = routineRows.flatMap((row) =>
    row.lastRun ? [lastRun(row.routine, row.lastRun, orgId)] : [],
  )
  const list: RoutinesResponse = {
    routines: routines.map((routine) => ({
      ...routine,
      lastRun: lastRuns.find((run) => run.routineId === routine.id) ?? null,
    })),
  }
  const runs = routines.flatMap((routine) => {
    const runList = runListOf[routine.id]
    if (runList) return listRuns(routine, runList)
    return lastRuns.filter((run) => run.routineId === routine.id)
  })
  // The routine that the flow "Create a routine" saves, as a create answers.
  const created: Routine = {
    ...record(mockupRoutines['morning-summary'], 0, orgId),
    createdAt: FAKE_TIME,
    updatedAt: FAKE_TIME,
  }
  return { list, routines, runs, created }
}
