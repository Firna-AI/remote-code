import type { StartStep } from '../../src/shared/generated/StartStep'
import type { WorkspaceStart } from '../../src/shared/generated/WorkspaceStart'
import type { User } from '../../src/shared/api'
import type { SendMessageRequest } from '../../src/shared/messages'
import type { AppDependencies, AppEnv } from '../env'
import type { DurableLifecycleState } from './durable-types'
import type { MaskedStartLog } from './masked-start-log'
import type { TurnTokenEndpoint } from '../model-gateway/types'
import type {
  WorkspaceStartJob,
  WorkspaceStartIntent,
  WorkspaceStartResult,
  WorkspaceCreationAdmission,
} from './start-types'

export const FIRST_MESSAGE_ADMISSION_KEY = 'lifecycle:first-message-admission'

export interface PendingTurn {
  turnId: string
  sessionId: string
  senderUserId: string
}

export type LifecycleActivityResult =
  | { ok: true }
  | { ok: false; error: { code: 'org_suspended'; message: string } }

/** Internal RPC only. Machine requests cannot register sender identities. */
export interface WorkspaceLifecycleEndpoint {
  initializeLifecycle(input: {
    workspaceId: string
    orgId: string
    firstMessage: SendMessageRequest
    firstSessionTitle?: string
    firstTurn: PendingTurn
  }): Promise<void>
  readLifecycle(): Promise<DurableLifecycleState | undefined>
  beginLifecycleStart(kind: WorkspaceStart['kind']): Promise<void>
  lifecycleStep(
    id: string,
    label: string,
    state: StartStep['state'],
  ): Promise<void>
  lifecyclePrepared(): Promise<void>
  lifecycleFailed(
    error: NonNullable<DurableLifecycleState['error']>,
  ): Promise<void>
  lifecycleStopped(): Promise<void>
  suspendLifecycle(workspaceId: string, ownerUserId: string): Promise<boolean>
  reconcileLifecycleAccess(workspaceId: string): Promise<void>
  clearLifecycle(): Promise<void>
  lifecycleActivity(): Promise<LifecycleActivityResult>
  credentialSender(turnId: string): Promise<string | null>
  retryFailedCreateCleanup(workspaceId: string): Promise<void>
  finishDiskMaintenance(): Promise<void>
  queueLifecycleStart(
    job: WorkspaceStartJob,
    intent?: WorkspaceStartIntent,
  ): Promise<boolean>
  waitLifecycleStart(): Promise<WorkspaceStartResult>
  waitCreationLifecycle(): Promise<WorkspaceStartResult>
  waitCreationAdmission(): Promise<WorkspaceCreationAdmission>
  readCreationLifecycleResult(): Promise<WorkspaceStartResult | undefined>
  readLifecycleStartLog(): Promise<MaskedStartLog>
}

export interface WorkspaceRuntime {
  env: AppEnv
  dependencies: AppDependencies
  workspace(id: string): WorkspaceLifecycleEndpoint & TurnTokenEndpoint
}

export interface FirstWorkspaceMessage {
  workspaceId: string
  sessionId: string
  turnId: string
  sender: User
  request: SendMessageRequest
  firstSessionTitle?: string
}
