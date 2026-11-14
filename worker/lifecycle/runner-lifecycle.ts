import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import type { DurableLifecycle } from './durable'
import type { TurnScopes } from './turns'
import type { AppEnv } from '../env'
import { HttpError } from '../http'
import { requireOrgMember } from './access'
import type { PendingTurn } from './workspace-runtime'
import type { LifecyclePublisher } from './durable-types'

export type RunnerLifecycleEvent = Extract<
  RunnerEvent,
  { type: 'runner.ready' | 'turn.started' | 'start.updated' }
>

/** Call only after Milestone 7 accepts an ordered runner event. */
export async function applyRunnerLifecycle(
  lifecycle: DurableLifecycle,
  turns: TurnScopes,
  event: RunnerLifecycleEvent,
  publish?: LifecyclePublisher,
): Promise<void> {
  const state = await lifecycle.read()
  if (
    !state ||
    state.state === 'stopped' ||
    state.state === 'archived' ||
    state.state === 'error' ||
    state.startStop !== undefined
  )
    return
  if (event.type === 'runner.ready') {
    await lifecycle.step('runner', 'Starting the agent', 'completed', publish)
    await lifecycle.runnerReady(publish)
  } else if (event.type === 'turn.started') {
    const turn = await turns.find(event.turnId)
    if (turn) await lifecycle.turn(turn.sessionId, true, publish)
  } else if (event.type === 'start.updated') {
    await lifecycle.reportStart(event.start, publish)
  }
}

export async function registerTrustedTurn(
  env: AppEnv,
  lifecycle: DurableLifecycle,
  turns: TurnScopes,
  turn: PendingTurn,
  publish?: LifecyclePublisher,
): Promise<void> {
  const state = await lifecycle.read()
  if (!state)
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  if (!['ready', 'working', 'unread', 'input'].includes(state.state))
    throw new HttpError(
      409,
      'workspace_not_ready',
      'The cloud computer is starting. Wait for it to finish.',
    )
  await requireOrgMember(env.DB, state.orgId, turn.senderUserId)
  await turns.register(turn)
  await lifecycle.turn(turn.sessionId, true, publish)
}
