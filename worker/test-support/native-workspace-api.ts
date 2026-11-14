import type { ChangesResponse } from '../../src/shared/generated/ChangesResponse'
import type { FileTreeResponse } from '../../src/shared/generated/FileTreeResponse'
import type { Attachment } from '../../src/shared/generated/Attachment'
import type { WorkspaceChat } from '../chat/backend'
import type { WorkspaceController } from '../lifecycle/workspace-controller-types'
import type { WorkspaceEventPublication } from '../lifecycle/workspace-platform'
import type { NativeChatCallbacks } from './native-chat-resolvers'
import type { NativeStorageHooks } from './native-storage'
import type { NativePeers } from './native-peers'
import type { WorkspaceLifecycleTransport } from '../lifecycle/workspace-transport'
import type { Workspace } from '../workspace'
import type { NativeRequests } from './native-requests'
import type { NativeChatObservers } from './native-chat-observers'
import type {
  ChatHistoryResponse,
  WorkspaceEvent,
  WorkspaceEventEnvelope,
} from '../chat/workspace-events'
import type { AttachmentStorageInput } from '../chat/attachment-storage'
import type { NativeByteChunk } from './native-attachment-controls'
import type { NativeQuery } from './native-d1'
import type { NativeLifecycleControls } from './native-lifecycle-controls'
import type { TurnTokenCheck } from '../model-gateway/types'
import type { ProviderAccountConfigurations } from '../sandbox/accounts'

export const NATIVE_TEST_TIME = 1_800_000_000_000

export interface NativeWorkspaceOptions {
  workspaceId?: string
  hooks?: NativeStorageHooks
  callbacks?: NativeChatCallbacks
  onPublication?(event: WorkspaceEventPublication): Promise<void>
  onQueued?(): Promise<void>
  environment?: Record<
    string,
    string | ProviderAccountConfigurations | undefined
  >
  observers?: NativeChatObservers
  idPrefix?: string
  idWidth?: number
  idFallback?: string
  onQuery?(query: NativeQuery): Promise<void>
}

interface NativeWorkspaceSnapshot {
  instanceId: string
  records: Map<string, unknown>
  writes: string[]
  alarmAt: number | null
  alarmGeneration: number
  now: number
  scheduledCount: number
}

interface NativeWorkspaceControls {
  checkTurnTokens(
    workspaceId: string,
    tokens: readonly string[],
  ): Promise<TurnTokenCheck[]>
  instanceId(): Promise<string>
  abortFixture(): Promise<void>
  initialize(options: NativeWorkspaceOptions, at: number): Promise<void>
  configure(options: NativeWorkspaceOptions): Promise<void>
  snapshot(): Promise<NativeWorkspaceSnapshot>
  nextIds(ids: string[]): Promise<void>
  setTime(at: number): Promise<void>
  advance(at: number): Promise<number>
  settled(): Promise<void>
  drain(): Promise<void>
  drainBackground(): Promise<void>
  reset(): Promise<void>
  rawRecords(): Promise<Map<string, unknown>>
  dispatchAlarm(): Promise<void>
  eventNumber(workspaceId: string): Promise<number>
  takeEvents(): Promise<WorkspaceEventEnvelope[]>
  takeStoredEvents(): Promise<WorkspaceEventEnvelope[]>
  persist(): Promise<void>
  captureDecrypt(active: boolean): Promise<void>
  captureWarnings(active: boolean): Promise<void>
  warningCount(): Promise<number>
  warningCalls(): Promise<unknown[][]>
  decryptCalls(): Promise<number>
  history(
    workspaceId: string,
    after?: number,
    through?: number,
  ): Promise<ChatHistoryResponse>
  fileProjection(
    kind: 'tree' | 'changes',
  ): Promise<FileTreeResponse | ChangesResponse | null>
  emitEvent(
    workspaceId: string,
    event: WorkspaceEvent,
  ): Promise<WorkspaceEventEnvelope>
  storeAttachmentChunks(
    input: AttachmentStorageInput,
    id: string,
    chunks: readonly NativeByteChunk[],
  ): Promise<Attachment>
  attachmentByteSample(
    id: string,
    positions: readonly number[],
  ): Promise<{ byteLength: number; samples: number[] }>
}

export interface NativeWorkspaceApi {
  chat: WorkspaceChat
  controller: WorkspaceController
  storage: DurableObjectStorage
  peers: NativePeers
  requests: NativeRequests
  lifecycleRpc: WorkspaceLifecycleTransport &
    Pick<
      Workspace,
      | 'scheduleImage'
      | 'archiveWorkspace'
      | 'restoreWorkspace'
      | 'resumeMemberCreation'
      | 'reportRunnerLifecycle'
      | 'registerLifecycleTurn'
      | 'finishLifecycleTurn'
      | 'runnerLifecycleDisconnected'
      | 'acknowledgeLifecycleFirstMessage'
    >
  lifecycleControls: NativeLifecycleControls
  controls: NativeWorkspaceControls
}
