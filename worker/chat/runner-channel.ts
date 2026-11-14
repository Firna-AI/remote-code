import type { RunnerFileCommand } from '../../src/shared/generated/RunnerFileCommand'
import { warnWorker } from '../warnings'
import { errorSummary, WarningId } from '../warning-values'
import type { WorkspaceEventEnvelope } from './workspace-events'
import { HttpError } from '../http'
import { RunnerConnections } from './runner-connections'
import type { NativeBrowserConnections } from './browser-connections'
import { RunnerDelivery } from './runner-delivery'
import { parseRunnerTransport } from './runner-input'
import type { ChatStore } from './store'
import type { WorkspaceTurnTokens } from '../model-gateway/workspace'
import { storeRunnerReceipt } from './runner-receipt'
import { RepairDelivery } from './repair-delivery'
import { prepareRunnerHello } from './runner-handshake'
import type {
  ChatDependencies,
  ChatCallbackPublisher,
  ActiveRunner,
  RunnerPeer,
  RunnerWorkspaceRecord,
} from './types'

export class RunnerChannel {
  readonly connections: RunnerConnections
  private readonly delivery: RunnerDelivery
  private readonly repairs: RepairDelivery
  private readonly store: ChatStore
  private readonly dependencies: ChatDependencies
  private readonly publish: (events: readonly WorkspaceEventEnvelope[]) => void

  constructor(
    store: ChatStore,
    dependencies: ChatDependencies,
    publish: (events: readonly WorkspaceEventEnvelope[]) => void,
    forRunningTurn: WorkspaceTurnTokens['forRunningTurn'],
    bind: (id: string) => void,
    native?: NativeBrowserConnections,
  ) {
    this.store = store
    this.dependencies = dependencies
    this.publish = publish
    this.delivery = new RunnerDelivery(
      store,
      dependencies,
      publish,
      () => this.flush(),
      forRunningTurn,
    )
    this.repairs = new RepairDelivery(store, publish)
    this.connections = new RunnerConnections(
      store,
      dependencies,
      publish,
      bind,
      (peer, value) => this.receive(peer, value),
      native,
    )
  }

  open(
    workspace: RunnerWorkspaceRecord,
    peer: RunnerPeer,
    socket?: WebSocket,
  ): Promise<void> {
    return this.connections.open(workspace, peer, socket)
  }

  disconnect(peer: RunnerPeer): void {
    this.connections.disconnect(peer)
  }
  close(): void {
    this.connections.close()
  }

  receive(peer: RunnerPeer, value: unknown): Promise<void> {
    return this.store.run(async () => {
      const active = this.connections.current
      if (!active || !active.peer.matches(peer)) return
      if (!(await active.peer.authorize())) return
      try {
        const input: unknown =
          typeof value === 'string' ? JSON.parse(value) : value
        await this.handle(active, input)
      } catch (error) {
        warnWorker({
          kind: 'runner_message_failed',
          workspaceId: WarningId.checked(active.workspace.id),
          error: errorSummary(error),
        })
        active.peer.close()
        throw error
      }
    })
  }

  private async handle(active: ActiveRunner, value: unknown): Promise<void> {
    const message = parseRunnerTransport(value)
    if (message.type === 'hello') {
      const welcome = await prepareRunnerHello(
        active,
        message,
        this.store,
        this.dependencies,
        this.publish,
      )
      if (!welcome) return
      active.streamId = message.streamId
      active.protocolVersion = welcome.protocolVersion
      active.loginKinds = message.loginKinds
      active.ready = welcome.ready
      await this.connections.persist(active)
      if (active.ready) this.connections.attachFiles(active)
      await active.peer.send({
        type: 'welcome',
        protocolVersion: welcome.protocolVersion,
        streamId: message.streamId,
        confirmedThrough: welcome.cursor,
      })
      await this.repairs.flush(active)
      await this.dependencies.runnerHello(
        active.workspace.id,
        this.publisher(active.workspace.id),
      )
      if (active.ready)
        await this.dependencies.runnerReady(
          active.workspace.id,
          this.publisher(active.workspace.id),
        )
      void this.store
        .run(() => this.flush())
        .catch(() => {
          if (this.connections.current === active) this.close()
          active.peer.close()
        })
      return
    }
    if (!active.streamId)
      throw new HttpError(
        400,
        'runner_hello_required',
        'The connection is not ready.',
      )
    if (
      message.type === 'file.read.result' ||
      message.type === 'file.diff.result'
    ) {
      if (active.id)
        await this.dependencies.receiveFileResult(message.value, active.id)
      return
    }
    if (message.streamId !== active.streamId)
      throw new HttpError(
        400,
        'runner_stream_mismatch',
        'The connection is not available.',
      )
    let stored: WorkspaceEventEnvelope[] = []
    let becameReady = false
    const cursor = await this.store.change(
      active.workspace.id,
      async (transaction) => {
        stored = []
        becameReady = false
        const through = await transaction.cursor(message.streamId)
        if (message.eventNumber !== through + 1) return through
        const receipt = await storeRunnerReceipt(
          transaction,
          active.workspace,
          message,
          this.dependencies,
        )
        becameReady = receipt.ready
        stored = receipt.stored
        await transaction.saveCursor(message.streamId, message.eventNumber)
        return message.eventNumber
      },
      this.publish,
    )
    if (message.eventNumber > cursor) {
      await active.peer.send({
        type: 'resend',
        streamId: message.streamId,
        fromEventNumber: cursor + 1,
      })
      return
    }
    await this.repairs.flush(active)
    await active.peer.send({
      type: 'confirm',
      streamId: message.streamId,
      throughEventNumber: cursor,
    })
    await this.store.reportTurnEnds()
    const publish = this.publisher(active.workspace.id)
    if (becameReady) {
      active.ready = true
      await this.connections.persist(active)
      this.connections.attachFiles(active)
      await this.dependencies.runnerReady(active.workspace.id, publish)
    }
    for (const envelope of stored)
      await this.dependencies.runnerEventStored(envelope, publish)
    await this.flush()
  }

  async flush(): Promise<void> {
    const active = this.connections.current
    if (active) {
      if (!(await active.peer.authorize())) return
      try {
        await this.repairs.flush(active)
      } catch (error) {
        this.close()
        throw error
      }
      await this.delivery.flush(
        active,
        () => this.connections.current === active,
        () => this.close(),
      )
    }
  }

  private publisher(workspaceId: string): ChatCallbackPublisher {
    return async (event, occurredAt) => {
      await this.store.change(
        workspaceId,
        (transaction) => transaction.emit(event, occurredAt),
        this.publish,
      )
    }
  }

  async sendFileCommand(
    workspaceId: string,
    command: RunnerFileCommand,
  ): Promise<boolean> {
    const active = this.connections.current
    if (!active?.ready || active.workspace.id !== workspaceId) return false
    try {
      await active.peer.send(command)
      return true
    } catch {
      this.close()
      return false
    }
  }
}
