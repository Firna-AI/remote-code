import type { StartStep } from '../../src/shared/generated/StartStep'
import type { WorkspaceStart } from '../../src/shared/generated/WorkspaceStart'
import {
  withStartStep,
  withStartFailure,
  withCreateFailure,
  withReportedStart,
  initialLifecycle,
  beginningLifecycleStart,
  readyLifecycle,
  withPreparedStart,
} from './durable-start'
import type { SendMessageRequest } from '../../src/shared/messages'
import { reconciledLifecycle } from './durable-reconciliation'
import { advanceDiskRetentionState } from './disk-retention-state'
import {
  writeLifecycleState,
  retryLifecyclePublication,
  scheduleLifecycleState,
} from './durable-scheduling'
import { ArchiveTransitions } from './durable-archive'
import { failedStartStop } from './durable-start-stop'
import { advanceLifecycleAlarm } from './durable-alarm'
import { applyLifecycleTurn, recoverLifecycleTurns } from './durable-turns'
import { isConfirmedStopped } from './confirmed-stop'
import { LifecycleInputState } from './input-activity-local'
import {
  LIFECYCLE_STATE_KEY,
  type DurableLifecycleState,
  type LifecycleHooks,
  type LifecycleStorage,
  type LifecyclePublisher,
} from './durable-types'

/** One instance lives inside each workspace Durable Object. */
export class DurableLifecycle {
  private pending: Promise<unknown> = Promise.resolve()
  private readonly archiveTransitions: ArchiveTransitions
  readonly input: LifecycleInputState
  private readonly storage: LifecycleStorage
  private readonly now: () => number
  private readonly hooks: LifecycleHooks

  constructor(
    storage: LifecycleStorage,
    now: () => number,
    hooks: LifecycleHooks,
  ) {
    this.storage = storage
    this.now = now
    this.hooks = hooks
    this.input = new LifecycleInputState({
      storage,
      now,
      serial: (operation) => this.serial(operation),
      write: (state) => this.write(state),
      extendDeadline: (request) => this.hooks.extendDeadline(request),
    })
    this.archiveTransitions = new ArchiveTransitions({
      storage,
      hooks,
      now,
      input: this.input,
      serial: (operation) => this.serial(operation),
    })
  }

  read(): Promise<DurableLifecycleState | undefined> {
    return this.storage.get(LIFECYCLE_STATE_KEY)
  }

  initialize(input: {
    workspaceId: string
    orgId: string
    firstMessage: SendMessageRequest
  }): Promise<void> {
    return this.serial(async () => {
      if (await this.read()) return
      await this.write(initialLifecycle(input, this.now()))
    })
  }

  beginStart(kind: WorkspaceStart['kind']): Promise<void> {
    return this.update((state) =>
      beginningLifecycleStart(state, kind, this.now()),
    )
  }

  step(
    id: string,
    label: string,
    status: StartStep['state'],
    publish?: LifecyclePublisher,
  ): Promise<void> {
    return this.update(
      (state) => withStartStep(state, id, label, status, this.now()),
      publish,
    )
  }

  runnerReady(publish?: LifecyclePublisher): Promise<void> {
    return this.update(readyLifecycle, publish)
  }

  runnerDisconnected(publish?: LifecyclePublisher): Promise<void> {
    return this.serial(async () => {
      const state = await this.read()
      if (state?.runnerConnected)
        await this.write({ ...state, runnerConnected: false }, publish)
    })
  }

  reportStart(
    start: WorkspaceStart,
    publish?: LifecyclePublisher,
  ): Promise<void> {
    return this.update((state) => withReportedStart(state, start), publish)
  }

  prepared(): Promise<void> {
    return this.update((state) => withPreparedStart(state, this.now()))
  }

  activity(): Promise<void> {
    return this.input.activity(() => this.hooks.extendDeadline())
  }

  rearmStopped(): Promise<void> {
    return this.serial(async () => {
      const state = await this.read()
      if (state && isConfirmedStopped(state)) await this.write(state)
    })
  }

  recoverTurns(publish?: LifecyclePublisher): Promise<void> {
    return this.update(
      (state) => recoverLifecycleTurns(state, this.hooks),
      publish,
    )
  }

  turn(
    sessionId: string,
    running: boolean,
    publish?: LifecyclePublisher,
  ): Promise<void> {
    const change = { sessionId, running }
    return this.update(
      (state) => applyLifecycleTurn(state, change, this.hooks, this.now),
      publish,
    )
  }

  stopped(): Promise<void> {
    return this.update((state) =>
      state.state === 'archived'
        ? state
        : reconciledLifecycle(state, 'stopped', this.now()),
    )
  }

  archive(): Promise<void> {
    return this.archiveTransitions.archive()
  }

  restoreStopped(
    stoppedAt: number | null,
    nextDiskKeepaliveAt: number,
    stopPending = false,
  ): Promise<void> {
    return this.archiveTransitions.restore(
      stoppedAt,
      nextDiskKeepaliveAt,
      stopPending,
    )
  }

  /** An access stop ends the restore watch, because its sandbox stops. */
  endRestoreWatch(): Promise<void> {
    return this.serial(async () => {
      const state = await this.read()
      if (state?.restoreWatchAt !== undefined)
        await this.write({ ...state, restoreWatchAt: undefined })
    })
  }

  fail(error: DurableLifecycleState['error'], create = false): Promise<void> {
    const failure = create ? withCreateFailure : withStartFailure
    return this.update((state) => failure(state, error, this.now()))
  }

  stopFailedStart(
    error: NonNullable<DurableLifecycleState['error']>,
    cancelled: boolean,
  ): Promise<void> {
    return this.update((state) =>
      failedStartStop(state, error, cancelled, this.now()),
    )
  }

  acknowledgeFirstMessage(publish?: LifecyclePublisher): Promise<void> {
    return this.update(
      (state) => ({ ...state, pendingFirstMessage: null }),
      publish,
    )
  }

  clear(preserveAlarm = false): Promise<boolean> {
    return this.serial(async () => {
      this.input.invalidate()
      if (!preserveAlarm) await this.storage.deleteAlarm()
      await this.storage.changedAlarm(null)
      return this.storage.delete(LIFECYCLE_STATE_KEY)
    })
  }

  finishDiskMaintenance(active: () => Promise<boolean>): Promise<boolean> {
    return this.serial(async () => {
      if (!(await active())) return true
      const state = await this.read()
      return !state || (await this.keepalive(state)).done
    })
  }

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.serial(operation)
  }

  schedule(): Promise<void> {
    return this.serial(async () => {
      const state = await this.read()
      if (state)
        await scheduleLifecycleState(this.storage, this.hooks, state, this.now)
    })
  }

  retryChanged(): Promise<void> {
    return this.serial(() =>
      retryLifecyclePublication(this.storage, this.hooks, this.now),
    )
  }

  alarm(): Promise<void> {
    return this.serial(async () => {
      const state = await this.read()
      if (state)
        await advanceLifecycleAlarm(
          this.storage,
          this.hooks,
          state,
          this.now,
          (next) => this.write(next),
          (next) => this.keepalive(next),
        )
    })
  }

  private update(
    change: (
      state: DurableLifecycleState,
    ) => DurableLifecycleState | Promise<DurableLifecycleState>,
    publish?: LifecyclePublisher,
  ): Promise<void> {
    return this.serial(async () => {
      const state = await this.read()
      if (state) await this.write(await change(state), publish)
    })
  }

  private async write(
    state: DurableLifecycleState,
    publish?: LifecyclePublisher,
  ): Promise<void> {
    this.input.invalidate()
    await writeLifecycleState(
      this.storage,
      this.hooks,
      state,
      this.now,
      publish,
    )
  }

  private keepalive(state: DurableLifecycleState) {
    return advanceDiskRetentionState(
      this.storage,
      this.hooks,
      state,
      this.now,
      (next) => this.write(next),
    )
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation)
    this.pending = next.catch(() => undefined)
    return next
  }
}
