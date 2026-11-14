import type { StartStep } from '../../src/shared/generated/StartStep'
import type { WorkspaceStart } from '../../src/shared/generated/WorkspaceStart'
import { RESTORE_POLL_MS, type DurableLifecycleState } from './durable-types'

export function withPreparedStart(
  state: DurableLifecycleState,
  now: number,
): DurableLifecycleState {
  if (state.state === 'stopped' || state.state === 'archived') return state
  return {
    ...state,
    startupPrepared: true,
    restoreWatchAt: state.startupPrepared
      ? state.restoreWatchAt
      : now + RESTORE_POLL_MS,
    state: state.runnerConnected
      ? state.runningSessions.length
        ? 'working'
        : 'ready'
      : 'starting',
  }
}

export function initialLifecycle(
  input: Pick<DurableLifecycleState, 'workspaceId' | 'orgId'> & {
    firstMessage: NonNullable<DurableLifecycleState['pendingFirstMessage']>
  },
  now: number,
): DurableLifecycleState {
  return {
    workspaceId: input.workspaceId,
    orgId: input.orgId,
    state: 'starting',
    start: null,
    pendingFirstMessage: input.firstMessage,
    lastActivityAt: now,
    runningSessions: [],
    runnerConnected: false,
    stoppedAt: null,
    nextDiskKeepaliveAt: null,
    error: null,
  }
}

export function beginningLifecycleStart(
  state: DurableLifecycleState,
  kind: WorkspaceStart['kind'],
  now: number,
): DurableLifecycleState {
  return {
    ...state,
    state: 'starting',
    start: { kind, startedAt: now, steps: [] },
    error: null,
    stoppedAt: null,
    nextDiskKeepaliveAt: null,
    diskRetentionDeadlineAt: undefined,
    runnerConnected: false,
    lastActivityAt: now,
    startupPrepared: false,
    restoreWatchAt: undefined,
    startStop: undefined,
    diskRetentionCommand: undefined,
  }
}

export function readyLifecycle(
  state: DurableLifecycleState,
): DurableLifecycleState {
  if (
    ['stopped', 'archived', 'error'].includes(state.state) ||
    state.startStop !== undefined
  )
    return state
  return {
    ...state,
    state:
      state.start && !state.startupPrepared
        ? 'starting'
        : state.runningSessions.length
          ? 'working'
          : ['unread', 'input'].includes(state.state)
            ? state.state
            : 'ready',
    runnerConnected: true,
    error: null,
    stoppedAt: null,
    nextDiskKeepaliveAt: null,
  }
}

export function withStartStep(
  state: DurableLifecycleState,
  id: string,
  label: string,
  status: StartStep['state'],
  now: number,
): DurableLifecycleState {
  if (!state.start) return state
  const old = state.start.steps.find((step) => step.id === id)
  const step: StartStep = {
    id,
    label,
    state: status,
    startedAt: old?.startedAt ?? now,
    completedAt:
      status === 'running'
        ? null
        : old?.state === status && old.completedAt !== null
          ? old.completedAt
          : now,
  }
  return {
    ...state,
    start: {
      ...state.start,
      steps: old
        ? state.start.steps.map((entry) => (entry.id === id ? step : entry))
        : [...state.start.steps, step],
    },
  }
}

export function withReportedStart(
  state: DurableLifecycleState,
  start: NonNullable<DurableLifecycleState['start']>,
): DurableLifecycleState {
  if (state.start && state.start.kind !== start.kind) return state
  const steps = new Map(
    (state.start?.steps ?? []).map((step) => [step.id, step]),
  )
  for (const step of start.steps) steps.set(step.id, step)
  return {
    ...state,
    start: {
      ...start,
      startedAt: state.start?.startedAt ?? start.startedAt,
      steps: [...steps.values()],
    },
  }
}

export function withStartFailure(
  state: DurableLifecycleState,
  error: DurableLifecycleState['error'],
  now: number,
): DurableLifecycleState {
  if (state.state === 'stopped' || state.state === 'archived') return state
  return {
    ...state,
    state: 'error',
    error,
    start: state.start
      ? {
          ...state.start,
          steps: state.start.steps.map((step) =>
            step.state === 'running'
              ? { ...step, state: 'failed', completedAt: now }
              : step,
          ),
        }
      : null,
  }
}

export function withCreateFailure(
  state: DurableLifecycleState,
  error: DurableLifecycleState['error'],
  now: number,
): DurableLifecycleState {
  if (state.state === 'stopped' || state.state === 'archived') return state
  const failed = withStartFailure(
    state.start
      ? state
      : {
          ...state,
          start: { kind: 'create', startedAt: now, steps: [] },
        },
    error,
    now,
  )
  return failed.start?.steps.some((step) => step.state === 'failed')
    ? failed
    : withStartStep(
        failed,
        'start',
        'Starting the cloud computer',
        'failed',
        now,
      )
}
