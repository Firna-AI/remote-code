import type { UserMessage } from '../../src/shared/generated/UserMessage'
import type { RunnerFileCommand } from '../../src/shared/generated/RunnerFileCommand'
import {
  type WorkspaceEvent,
  type WorkspaceEventEnvelope,
} from './workspace-events'
import type {
  ToolSessionAccess,
  ToolSessionWrite,
  ToolSessionManagement,
} from '../tools/services'
import type { FirstWorkspaceMessage } from '../lifecycle/workspace-runtime'
import type { AppEnv } from '../env'
import { WorkspaceTurnTokens } from '../model-gateway/workspace'
import { chatDependencies } from './dependencies'
import {
  authorizeChatBrowser,
  type BrowserAccess,
} from './browser-authorization'
import { fetchWorkspaceChat } from './backend-fetch'
import {
  BrowserConnections,
  type NativeBrowserConnections,
} from './browser-connections'
import { authorizeChatRunner } from './runner-authorization'
import { WorkspaceTitles } from './workspace-titles'
import { WorkspaceOperations } from './workspace-operations'
import { ChatWorkspaceBinding } from './workspace-binding'
import type { ChatWorkspaceSummary } from './workspace-summary'
import { ChatOperation } from './operation'
import { RunnerChannel } from './runner-channel'
import type { ChatStore, ChatTransaction } from './store'
import type { QueueTurn } from './queue-turn'
import { createWorkspaceChatStore } from './workspace-store'
import {
  runWorkspaceOperation,
  type WorkspaceOperation,
} from './workspace-operation'
import { openBrowser } from './sockets'
import type {
  BrowserPeer,
  ChatDependencies,
  ChatStorage,
  RunnerPeer,
} from './types'

/** The Durable Object and the in-memory runner adapter use this boundary. */
export class WorkspaceChat {
  private readonly storage: ChatStorage
  readonly store: ChatStore
  readonly turnTokens: WorkspaceTurnTokens
  private readonly env: AppEnv
  private readonly dependencies: ChatDependencies
  readonly runner: RunnerChannel
  readonly browsers: BrowserConnections
  private readonly operations: WorkspaceOperations
  private readonly titles: WorkspaceTitles
  private readonly binding: ChatWorkspaceBinding

  async workspaceSummary(workspaceId?: string): Promise<ChatWorkspaceSummary> {
    return this.operations.summary(workspaceId)
  }

  runLifecycle<T>(operation: (turn: QueueTurn) => Promise<T>): Promise<T> {
    return this.store.run(operation)
  }

  flushRunner(): Promise<void> {
    return this.runner.flush()
  }

  acceptToolWrite(
    input: ToolSessionWrite,
    authorize: () => Promise<ToolSessionAccess>,
  ) {
    return this.operations.writeTool(input, authorize)
  }

  manageToolSession(
    input: ToolSessionManagement,
    origin: string,
    authorize: () => Promise<ToolSessionAccess>,
  ) {
    return this.operations.manageTool(input, origin, authorize)
  }

  async acceptFirstMessage(first: FirstWorkspaceMessage): Promise<UserMessage> {
    return this.operations.accept(first)
  }

  async stopWorkspace(workspaceId: string): Promise<void> {
    await this.operations.stop(workspaceId)
  }

  commitWorkspaceEvent(
    workspaceId: string,
    event: WorkspaceEvent,
    occurredAt?: number,
  ): Promise<void> {
    return this.operations.commit(workspaceId, event, occurredAt)
  }

  commitPreviewRevocations(workspaceId: string, previewIds: readonly string[]) {
    return this.operations.revokePreviews(workspaceId, previewIds)
  }

  constructor(
    storage: ChatStorage,
    env: AppEnv,
    overrides: Partial<ChatDependencies> = {},
    native?: NativeBrowserConnections,
  ) {
    this.storage = storage
    this.env = env
    this.binding = new ChatWorkspaceBinding(
      overrides.matchesObject ?? (() => true),
    )
    this.dependencies = chatDependencies(env, () => this.binding.id, overrides)
    this.store = createWorkspaceChatStore(
      storage,
      env,
      this.dependencies,
      this.publish,
    )
    this.titles = new WorkspaceTitles(
      env,
      this.store,
      this.dependencies,
      (events) => this.publish(events),
    )
    this.browsers = new BrowserConnections(
      this.store,
      this.dependencies,
      (id) => this.operation(id),
      (id) => this.binding.bind(id),
      native,
    )
    this.turnTokens = new WorkspaceTurnTokens(
      this,
      env,
      (id) => this.operation(id),
      this.dependencies.randomId,
    )
    this.runner = new RunnerChannel(
      this.store,
      this.dependencies,
      (events) => this.publish(events),
      (id, turnId, kind) => this.turnTokens.forRunningTurn(id, turnId, kind),
      (id) => this.binding.bind(id),
      native,
    )
    this.operations = new WorkspaceOperations({
      env,
      store: this.store,
      dependencies: this.dependencies,
      workspaceId: () => this.binding.id,
      bind: (id) => this.binding.bind(id),
      publish: (events) => this.publish(events),
      closeRunner: () => this.runner.close(),
      flushRunner: () => this.runner.flush(),
    })
  }

  fetch(request: Request): Promise<Response> {
    return fetchWorkspaceChat(request, {
      chat: this,
      store: this.store,
      storage: this.storage,
      env: this.env,
      dependencies: this.dependencies,
      operation: (id) => this.operation(id),
    })
  }

  async authorizeBrowser(request: Request): Promise<BrowserAccess> {
    const access = await authorizeChatBrowser(
      request,
      this.env,
      this.dependencies.now(),
    )
    this.binding.bind(access.workspace.id)
    return access
  }

  async connectRunner(
    request: Request,
    peer: RunnerPeer,
    socket?: WebSocket,
  ): Promise<void> {
    const workspace = await authorizeChatRunner(this.env, request)
    this.binding.bind(workspace.id)
    await this.runner.open(workspace, peer, socket)
  }

  receiveRunner(peer: RunnerPeer, value: unknown): Promise<void> {
    return this.runner.receive(peer, value)
  }
  disconnectRunner(peer: RunnerPeer): void {
    this.runner.disconnect(peer)
  }

  closeRunner(): void {
    this.runner.close()
  }

  closeConnections(): void {
    this.runner.close()
    this.browsers.closeAll()
  }

  /** Trusted feature owners share the same stored browser event sequence. */
  async appendWorkspaceEvent(
    workspaceId: string,
    event: WorkspaceEvent,
    occurredAt = this.dependencies.now(),
  ): Promise<void> {
    await this.changeWorkspace(workspaceId, (transaction) =>
      transaction.emit(event, occurredAt),
    )
  }

  readWorkspace<T>(
    workspaceId: string,
    work: (view: ChatTransaction) => Promise<T>,
  ): Promise<T> {
    this.binding.bind(workspaceId)
    return this.store.run(() => this.store.read(workspaceId, work))
  }

  /** Keep feature records, events, and publication in one serial task. */
  changeWorkspace<T>(
    workspaceId: string,
    work: (transaction: ChatTransaction) => Promise<T>,
  ): Promise<T> {
    this.binding.bind(workspaceId)
    return this.store.run(() =>
      this.store.change(workspaceId, work, (events) => this.publish(events)),
    )
  }

  authorizedWorkspaceOperation<T>(
    workspaceId: string,
    authorize: () => Promise<void>,
    work: (operation: WorkspaceOperation) => Promise<T>,
  ): Promise<T> {
    this.binding.bind(workspaceId)
    return runWorkspaceOperation(
      this.store,
      workspaceId,
      authorize,
      this.publish,
      work,
    )
  }

  async sendFileCommand(
    workspaceId: string,
    command: RunnerFileCommand,
  ): Promise<boolean> {
    this.binding.bind(workspaceId)
    return this.store.run(async () =>
      this.runner.sendFileCommand(workspaceId, command),
    )
  }

  async openBrowser(request: Request, peer: BrowserPeer): Promise<() => void> {
    return openBrowser(this, request, peer)
  }

  subscribe(
    access: BrowserAccess,
    after: number,
    peer: BrowserPeer,
    socket?: WebSocket,
  ): Promise<() => void> {
    return this.browsers.subscribe(access, after, peer, socket)
  }

  private operation(workspaceId: string): ChatOperation {
    return new ChatOperation(
      this.store,
      workspaceId,
      this.dependencies,
      this.publish,
    )
  }

  private publish = (events: readonly WorkspaceEventEnvelope[]): void => {
    this.browsers.publish(events)
    this.titles.accepted(events)
  }
}
