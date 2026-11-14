import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import type { UserMessage } from '../../shared/generated/UserMessage'
import type { StartStep } from '../../shared/generated/StartStep'
import { attachmentFiles } from '../../app/dev/attachment-files'
import type { OrderedWorkspaceResponse } from '../../shared/workspaces'
import type { DevBackend } from './dev-backend'
import { setActiveTurn } from './dev-sessions'

function setState(backend: DevBackend, state: WorkspaceState): void {
  backend.workspace = {
    ...backend.workspace,
    state,
    updatedAt: backend.clock.now(),
  }
  backend.stream.emit({
    type: 'workspace.updated',
    workspace: backend.workspace,
  })
  backend.sync()
}

function later(backend: DevBackend, delay: number, run: () => void): void {
  backend.timers.push(window.setTimeout(run, delay))
}

/** Resume: the sandbox starts again with its files, then becomes ready. */
export function resume(backend: DevBackend): OrderedWorkspaceResponse {
  const now = backend.clock.now()
  backend.start = {
    kind: 'resume',
    startedAt: now,
    steps: [
      {
        id: 'restore',
        label: 'Resuming with your files as you left them',
        state: 'running',
        startedAt: now,
        completedAt: null,
      },
    ],
  }
  setState(backend, 'starting')
  backend.stream.emit({ type: 'start.updated', start: backend.start })
  later(backend, 2_500, () => makeReady(backend))
  return {
    workspace: backend.workspace,
    start: backend.start,
    error: null,
    eventNumber: backend.stream.last,
  }
}

function addStep(backend: DevBackend, id: string, label: string): void {
  const start = backend.start
  if (!start) return
  const now = backend.clock.now()
  const done = start.steps.map((step): StartStep => ({
    ...step,
    state: 'completed',
    completedAt: now,
  }))
  const step: StartStep = {
    id,
    label,
    state: 'running',
    startedAt: now,
    completedAt: null,
  }
  backend.start = { ...start, steps: [...done, step] }
  backend.stream.emit({ type: 'start.updated', start: backend.start })
  backend.sync()
}

/**
 * Finishes the start: the steps of a new workspace one by one, then a ready
 * sandbox, which gives each queued message to the agent.
 */
export function makeReady(backend: DevBackend): void {
  if (backend.start?.kind === 'create') {
    later(backend, 0, () =>
      addStep(backend, 'fetch', 'Fetching main of acme/storefront'),
    )
    later(backend, 900, () =>
      addStep(backend, 'branch', `Creating branch ${backend.workspace.branch}`),
    )
  }
  later(backend, backend.start?.kind === 'create' ? 1_800 : 0, () => {
    setState(backend, 'ready')
    const bySession = new Map<string, UserMessage[]>()
    for (const message of backend.queue) {
      bySession.set(message.sessionId, [
        ...(bySession.get(message.sessionId) ?? []),
        message,
      ])
    }
    backend.queue = []
    for (const [sessionId, messages] of bySession) {
      for (const message of messages)
        attachmentFiles(backend).copy(
          backend.target.orgId,
          backend.target.workspaceId,
          message.attachments,
        )
      backend.agent.start(sessionId, messages)
    }
  })
}

/** Ends the running turn of a session as stopped: the scripted or the recorded one. */
function endTurn(backend: DevBackend, sessionId: string): void {
  const recorded = backend.recordedTurns.get(sessionId)
  backend.agent.interrupt(sessionId)
  if (!recorded) return
  backend.recordedTurns.delete(sessionId)
  backend.stream.emit({
    sessionId,
    turnId: recorded,
    type: 'turn.completed',
    state: 'stopped',
    durationMs: 161_000,
    files: [],
    omittedFileCount: 0,
    userMessageIds: [],
  })
  setActiveTurn(backend, sessionId, null, null)
}

/**
 * Stop, or the close of a tab whose turn runs: the workspace records the
 * member who asked, then the turn ends as stopped.
 */
export function requestStop(backend: DevBackend, sessionId: string): void {
  const turnId =
    backend.agent.running(sessionId) ?? backend.recordedTurns.get(sessionId)
  if (!turnId) return
  backend.stream.emit({
    type: 'turn.stop-requested',
    sessionId,
    turnId,
    requestedById: backend.viewer.id,
  })
  endTurn(backend, sessionId)
}

/** The sandbox stops: each running turn ends as stopped, with no Stop request. */
export function stopSandbox(backend: DevBackend): void {
  const running = [
    ...backend.agent.runningSessions(),
    ...backend.recordedTurns.keys(),
  ]
  for (const sessionId of new Set(running)) endTurn(backend, sessionId)
  setState(backend, 'stopped')
}

export function failStart(backend: DevBackend): void {
  setState(backend, 'error')
}

/**
 * The fake starts every new workspace. The page gives it the state of its
 * address, as it gives the state to the other workspace, so that the first
 * turn of a new workspace can show a ready sandbox.
 */
export function takeState(backend: DevBackend, state: WorkspaceState): void {
  backend.workspace = { ...backend.workspace, state }
  backend.start = null
  backend.sync()
}
