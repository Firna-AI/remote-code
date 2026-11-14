import type { RunnerProtocolVersion } from '../../src/shared/generated/RunnerProtocolVersion'
import type { WorkspaceEventEnvelope } from './workspace-events'
import {
  isSupportedRunnerVersion,
  RUNNER_PROTOCOL_VERSION,
} from '../../src/shared/runner'
import type {
  WorkspaceSockets,
  NativeSocketAttachment,
} from '../native-sockets'
import { CONNECTION_CHECK_MS } from '../security/connection-access'
import { AuthenticatedRunner } from './authenticated-runner'
import {
  RunnerConnectionStore,
  type StoredRunnerConnection,
} from './runner-connection-store'
import type { ChatStore } from './store'
import { failUnsupportedRunner } from './runner-unsupported'
import type {
  ActiveRunner,
  ChatDependencies,
  RunnerPeer,
  RunnerWorkspaceRecord,
} from './types'

interface NativeRunnerConnections {
  sockets: WorkspaceSockets
  storage: DurableObjectStorage
}

export class RunnerConnections {
  current: ActiveRunner | null = null
  private record: StoredRunnerConnection | null = null
  private retained = false
  private readonly peers = new WeakMap<WebSocket, RunnerPeer>()
  private readonly store: ChatStore
  private readonly dependencies: ChatDependencies
  private readonly publish: (events: readonly WorkspaceEventEnvelope[]) => void
  private readonly bind: (id: string) => void
  private readonly native?: NativeRunnerConnections
  private readonly saved?: RunnerConnectionStore

  constructor(
    store: ChatStore,
    dependencies: ChatDependencies,
    publish: (events: readonly WorkspaceEventEnvelope[]) => void,
    bind: (id: string) => void,
    receive: (peer: RunnerPeer, value: unknown) => Promise<void>,
    native?: NativeRunnerConnections,
  ) {
    this.store = store
    this.dependencies = dependencies
    this.publish = publish
    this.bind = bind
    this.native = native
    this.saved = native && new RunnerConnectionStore(native.storage)
    native?.sockets.register('runner', {
      restore: (socket, state) => this.restore(socket, state),
      message: async (socket, _state, value) => {
        const peer = this.peers.get(socket)
        if (!peer) return
        try {
          await receive(peer, value)
        } catch {
          this.disconnect(peer)
        }
      },
      close: async (socket, state) => {
        if (!this.peers.has(socket)) await this.restore(socket, state)
        const peer = this.peers.get(socket)
        this.peers.delete(socket)
        if (peer) this.disconnect(peer)
        if (socket.readyState !== WebSocket.CLOSED)
          socket.close(1000, 'Connection closed.')
      },
    })
  }

  open(
    workspace: RunnerWorkspaceRecord,
    peer: RunnerPeer,
    socket?: WebSocket,
  ): Promise<void> {
    return this.store.run(async () => {
      await this.store.read(workspace.id, async () => undefined)
      this.close()
      this.retained = socket !== undefined
      const record = {
        id: this.dependencies.randomConnectionId(),
        generation: 1,
        workspace,
        streamId: null,
        protocolVersion: null,
        loginKinds: undefined,
        ready: false,
        checkAt: this.dependencies.now() + CONNECTION_CHECK_MS,
      }
      if (socket) {
        if (!this.native || !this.saved)
          throw new Error('The native runner transport is missing.')
        this.record = await this.saved.replace(record)
        this.native.sockets.accept(socket, {
          version: 1,
          role: 'runner',
          id: this.record.id,
          generation: this.record.generation,
        })
        this.peers.set(socket, peer)
      } else this.record = record
      this.activate(peer, this.record, null)
      await this.arm()
    })
  }

  private activate(
    source: RunnerPeer,
    record: StoredRunnerConnection,
    protocolVersion: RunnerProtocolVersion | null,
  ): void {
    this.record = record
    const saved = this.retained ? this.saved : undefined
    const active: ActiveRunner = {
      id: record.id,
      workspace: record.workspace,
      streamId: record.streamId,
      protocolVersion,
      loginKinds: record.loginKinds,
      ready: record.ready,
      peer: new AuthenticatedRunner(
        source,
        record.workspace,
        {
          ...this.dependencies,
          scheduleRunnerCheck: this.retained
            ? undefined
            : this.dependencies.scheduleRunnerCheck,
        },
        () => {
          if (this.current !== active) return
          this.current = null
          this.record = null
          this.dependencies.runnerDetached(active.id)
          this.dependencies.waitUntil(
            Promise.all([
              saved?.save(null, record.generation),
              this.arm(),
              this.store.run(() =>
                this.dependencies.runnerDisconnected(
                  active.workspace.id,
                  async (event, occurredAt) => {
                    await this.store.change(
                      active.workspace.id,
                      (transaction) => transaction.emit(event, occurredAt),
                      this.publish,
                    )
                  },
                ),
              ),
            ]),
          )
        },
      ),
    }
    this.current = active
    if (active.ready) this.attachFiles(active)
  }

  private async restore(
    socket: WebSocket,
    state: NativeSocketAttachment,
  ): Promise<boolean> {
    if (state.role !== 'runner') return false
    const record = await this.saved?.current()
    if (
      !record ||
      record.id !== state.id ||
      record.generation !== state.generation
    )
      return false
    this.bind(record.workspace.id)
    const protocolVersion = record.protocolVersion
    if (
      !isSupportedRunnerVersion(protocolVersion) &&
      (protocolVersion !== null || record.streamId !== null)
    ) {
      await this.saved?.save(null, record.generation)
      if (protocolVersion === null || protocolVersion < RUNNER_PROTOCOL_VERSION)
        await this.store.run(() =>
          failUnsupportedRunner(
            this.store,
            this.dependencies,
            this.publish,
            record.workspace.id,
          ),
        )
      return false
    }
    const peer: RunnerPeer = {
      send: (message) => socket.send(JSON.stringify(message)),
      close: () => socket.close(1000, 'Connection closed.'),
    }
    this.peers.set(socket, peer)
    this.retained = true
    this.activate(peer, record, protocolVersion)
    await this.arm()
    return true
  }

  disconnect(peer: RunnerPeer): void {
    if (this.current?.peer.matches(peer)) this.close()
  }
  close(): void {
    this.current?.peer.close()
  }

  async persist(active: ActiveRunner): Promise<void> {
    const record = this.record
    if (this.current !== active || !record) return
    record.streamId = active.streamId
    record.protocolVersion = active.protocolVersion
    record.loginKinds = active.loginKinds
    record.ready = active.ready
    if (this.retained) await this.saved?.save(record, record.generation)
  }

  attachFiles(active: ActiveRunner): void {
    this.dependencies.runnerAttached(
      active.workspace.id,
      active.id,
      (command) =>
        this.store.run(async () => {
          if (this.current !== active) return false
          try {
            await active.peer.send(command)
            return true
          } catch {
            active.peer.close()
            return false
          }
        }),
    )
  }

  async alarm(): Promise<void> {
    if (!this.retained) return
    const active = this.current
    const record = this.record
    if (!active || !record) {
      await this.arm()
      return
    }
    if (record.checkAt > this.dependencies.now()) {
      await this.arm()
      return
    }
    record.checkAt = this.dependencies.now() + CONNECTION_CHECK_MS
    if (this.retained) await this.saved?.save(record, record.generation)
    await active.peer.authorize()
    await this.arm()
  }

  private arm(): Promise<void> {
    if (!this.retained) return Promise.resolve()
    return (
      this.dependencies.runnerAlarm?.(this.record?.checkAt ?? null) ??
      Promise.resolve()
    )
  }
}
