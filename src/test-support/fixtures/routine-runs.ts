import type { MessageSender } from '../../shared/generated/MessageSender'
import {
  runsOf,
  type FailedRun,
  type ListedRun,
  type Run,
  type SkipReason,
} from '../../../docs/mockups/src/fixtures/routineRuns'
import { routines as mockupRoutines } from '../../../docs/mockups/src/fixtures/routines'
import {
  runLists,
  type RunListKey,
} from '../../../docs/mockups/src/fixtures/runLists'
import type {
  Routine,
  RoutinePullRequestEvent,
  RoutineRun,
  RoutineRunsResponse,
  RoutineRunTrigger,
} from '../../shared/routines'
import { FAKE_TIME } from './core'

const day = 86_400_000

/** The units of the ages that the mockups write, such as "5m" or "2w". */
const units: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 3_600_000,
  d: day,
  w: 7 * day,
}

/** The time of an age that the mockups write, such as "now" or "3d". */
export function timeOf(when: string): number {
  if (when === 'now') return FAKE_TIME
  const match = /^(\d+)([mhdw])$/.exec(when)
  const unit = match ? units[match[2]] : undefined
  if (!match || unit === undefined) throw new Error(`Unknown age: ${when}`)
  return FAKE_TIME - Number(match[1]) * unit
}

/**
 * The trigger of a run that a pull request of the routine's repository
 * started, with the login of the account that a skip names.
 */
export function pullRequestTrigger(
  repositoryId: string,
  event: RoutinePullRequestEvent,
  number: number,
  skipLogin?: string,
): RoutineRunTrigger {
  return {
    kind: 'pull-request',
    event,
    number,
    url: `https://github.com/acme/${repositoryId}/pull/${number}`,
    headBranch: 'cal/saved-carts',
    headSha: '4f2a9c1',
    baseBranch: 'main',
    ...(skipLogin === undefined ? {} : { skipLogin }),
  }
}

/** Each cause of a failed run, as the Worker stores it. */
const failures: Readonly<
  Record<Exclude<FailedRun['cause'], 'turn'>, { code: string; message: string }>
> = {
  'agent-login': {
    code: 'agent_login_required',
    message: 'Connect Claude to run this routine.',
  },
  'github-access': {
    code: 'github_reconnect_required',
    message: 'GitHub access expired. Sign in with GitHub again.',
  },
  start: {
    code: 'workspace_start_failed',
    message: 'The cloud computer could not start. Try again.',
  },
}

/** Each reason of a skipped run, as the Worker stores it. */
function skipOf(skip: SkipReason): { code: string; message: string } {
  switch (skip.who) {
    case 'author':
      return {
        code: 'author_not_allowed',
        message:
          'The pull request author is outside the org and is not in Author is.',
      }
    case 'sender':
      return {
        code: 'sender_not_allowed',
        message: 'The event sender is outside the org and is not in Author is.',
      }
    case 'org':
      return { code: 'org_suspended', message: 'The org is suspended.' }
  }
}

/** The login of the account outside the org that a skip names, if any. */
function skipLogin(run: Run): string | undefined {
  if (run.state !== 'skipped' || run.skip.who === 'org') return undefined
  return run.skip.login
}

/**
 * Whether a run has a workspace: a run in the state of a workspace, and a
 * run whose first start or first turn failed, which keeps its workspace. A
 * queued or skipped run has none, and neither has a run that a check failed
 * before the create.
 */
function hasWorkspace(run: Run): boolean {
  switch (run.state) {
    case 'queued':
    case 'skipped':
      return false
    case 'failed':
      return run.cause === 'start' || run.cause === 'turn'
    default:
      return true
  }
}

/**
 * The owner of a run, as the Worker names them. A member who left the org
 * keeps their user record, so a run still names them, with a login from
 * their name.
 */
function ownerOf(run: Run): MessageSender {
  const { owner } = run
  if ('key' in owner) {
    return {
      id: owner.key,
      githubLogin: owner.login,
      displayName: owner.name,
      avatarUrl: null,
    }
  }
  const login = owner.name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return {
    id: login,
    githubLogin: login,
    displayName: owner.name,
    avatarUrl: null,
  }
}

/**
 * A run of a mockup list, as the Worker gives it, with its own agent and
 * owner. A run that has a workspace keeps its ID. A skip of an author or a
 * sender keeps the login of that account. Each run is a little older than
 * the run before it, so the order of the list holds when two runs have the
 * same age.
 */
function apiRun(routine: Routine, run: Run, index: number): RoutineRun {
  const at = timeOf(run.when) - index
  const trigger: RoutineRunTrigger =
    run.trigger.kind === 'schedule'
      ? { kind: 'schedule', schedule: run.trigger.schedule, scheduledAt: at }
      : run.trigger.kind === 'run-now'
        ? { kind: 'run-now' }
        : pullRequestTrigger(
            routine.repositoryId,
            run.trigger.event,
            run.trigger.number,
            skipLogin(run),
          )
  return {
    id: `run-${routine.id}-${run.key}`,
    routineId: routine.id,
    orgId: routine.orgId,
    agent: run.agent,
    owner: ownerOf(run),
    trigger,
    state: run.state,
    workspaceId: hasWorkspace(run) ? `${routine.id}-${run.key}` : null,
    error:
      run.state === 'failed'
        ? run.cause === 'turn'
          ? { code: 'agent_unavailable', message: run.message }
          : failures[run.cause]
        : run.state === 'skipped'
          ? skipOf(run.skip)
          : null,
    createdAt: at,
    updatedAt: at,
  }
}

/**
 * The runs of the review routine after its newest 50, which Show older
 * runs adds: an open and a push of each pull request below #453.
 */
const olderReviewRuns: readonly ListedRun[] = Array.from(
  { length: 6 },
  (_, index): ListedRun => {
    const number = 452 - Math.floor(index / 2)
    const event = index % 2 === 0 ? 'pushed' : 'opened'
    return {
      key: `${event}-${number}`,
      trigger: { kind: 'pull-request', event, number },
      state: 'archived',
      when: '3w',
    }
  },
)

/** The run lists that hold older runs than the newest 50. */
const olderRuns: Partial<Record<RunListKey, readonly Run[]>> = {
  review: runsOf(mockupRoutines['review-prs'], olderReviewRuns),
  suspended: runsOf(mockupRoutines['review-prs'], olderReviewRuns),
}

/** The run list of each routine of the mockups that draws one. */
export const runListOf: Readonly<Record<string, RunListKey>> = {
  'review-prs': 'review',
  'dependency-updates': 'weekly',
  'copy-review': 'owner-left',
  'error-triage': 'turned-off',
}

/** Every run of a routine from a run list of the mockups, newest first. */
export function listRuns(routine: Routine, list: RunListKey): RoutineRun[] {
  const runs = [...runLists[list], ...(olderRuns[list] ?? [])]
  return runs.map((run, index) => apiRun(routine, run, index))
}

/**
 * One page of runs, newest first, as the Worker gives it: the newest 50
 * after the run of `before`, and the cursor of the next older page.
 */
export function runsPage(
  runs: readonly RoutineRun[],
  before: string | null = null,
): RoutineRunsResponse {
  const start = before ? runs.findIndex((run) => run.id === before) + 1 : 0
  const page = runs.slice(start, start + 50)
  const more = runs.length > start + 50
  return { runs: page, nextCursor: more ? (page.at(-1)?.id ?? null) : null }
}
