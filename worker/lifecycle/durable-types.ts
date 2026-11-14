import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'
import type { WorkspaceStart } from '../../src/shared/generated/WorkspaceStart'
import type { SendMessageRequest } from '../../src/shared/messages'
import type { WorkspacePlatform } from './workspace-platform'

import type {
  RetentionCommandPort,
  RetentionCommandState,
} from './retention-command'

export type LifecyclePublisher = WorkspacePlatform['publish']

export const IDLE_MS = 30 * 60 * 1_000
export const DISK_KEEPALIVE_MS = 13 * 24 * 60 * 60 * 1_000
export const TURN_HEARTBEAT_MS = 5 * 60 * 1_000
export const RESTORE_POLL_MS = 5_000
export const LIFECYCLE_STATE_KEY = 'lifecycle:state'

export interface LifecycleStorage {
  get(key: string): Promise<DurableLifecycleState | undefined>
  put(key: string, value: DurableLifecycleState): Promise<void>
  delete(key: string): Promise<boolean>
  setAlarm(timestamp: number): Promise<void>
  deleteAlarm(): Promise<void>
  changedAlarm(timestamp: number | null, keepEarlier?: boolean): Promise<void>
}

export interface DurableLifecycleState {
  workspaceId: string
  orgId: string
  state: WorkspaceState
  start: WorkspaceStart | null
  pendingFirstMessage: SendMessageRequest | null
  lastActivityAt: number
  runningSessions: readonly string[]
  runnerConnected: boolean
  startupPrepared?: boolean
  restoreWatchAt?: number
  startStop?: 'pending' | 'stopped' | 'error'
  stoppedAt: number | null
  nextDiskKeepaliveAt: number | null
  diskRetentionDeadlineAt?: number
  diskRetentionCommand?: RetentionCommandState
  error: { code: string; message: string; log: string | null } | null
}

export type DiskRetentionResult =
  | { done: false; error: string | null }
  | {
      done: true
      error: string | null
      stoppedAt: number | null
      eligible: boolean
    }

export type LifecycleDeadlineRequest =
  | { kind: 'check' }
  | {
      kind: 'input'
      extend(): Promise<LifecycleReconciliation>
    }

export interface LifecycleHooks {
  changed(
    state: DurableLifecycleState,
    publish?: LifecyclePublisher,
  ): boolean | void | Promise<boolean | void>
  stop(): Promise<LifecycleStopResult | void>
  keepalive(
    deadlineAt: number,
    command: RetentionCommandPort,
    confirmedStopped: boolean,
  ): Promise<DiskRetentionResult>
  extendDeadline(
    request?: LifecycleDeadlineRequest,
  ): Promise<LifecycleReconciliation | void>
  reconcile?(): Promise<LifecycleReconciliation>
  checkRestore?(): Promise<LifecycleRestoreResult>
  startPending?(): Promise<boolean>
  recoverTurns?(workspaceId: string): Promise<LifecycleTurnRecovery | undefined>
  lastTurnEndedAt?(workspaceId: string): Promise<number | null>
}

export interface LifecycleTurnRecovery {
  runningSessions: readonly string[]
  lastTurnEndedAt: number | null
}

export type LifecycleReconciliation = 'stopped' | 'error' | undefined
export type LifecycleRestoreResult = 'pending' | 'done' | 'stopped' | 'error'
export type LifecycleStopResult = 'stopped' | 'error' | 'pending'
