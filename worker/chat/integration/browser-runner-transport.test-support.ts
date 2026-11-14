import { WebSocket } from 'miniflare'
import type { RunnerCommand } from '../../../src/shared/generated/RunnerCommand'
import type { RunnerEvent } from '../../../src/shared/generated/RunnerEvent'
import type { RunnerEventEnvelope } from '../../../src/shared/generated/RunnerEventEnvelope'
import type { RunnerToWorkspace } from '../../../src/shared/generated/RunnerToWorkspace'
import { readBrowserRunnerMessage } from './browser-runner-message.test-support'
import { RUNNER_PROTOCOL_VERSION } from '../../../src/shared/runner'
import type { OuterRuntime } from './outer-runtime.test-support'
import { requestRunner } from './runner-socket.test-support'

export class BrowserRunnerTransport {
  readonly warnings: string[] = []
  private socket: WebSocket | undefined
  private connecting: Promise<void> | undefined
  private stopped = true
  private welcomed = false
  private readySent = false
  private eventNumber = 0
  private confirmedThrough = 0
  private readonly outbox = new Map<number, RunnerEventEnvelope>()
  private closed: Promise<void> = Promise.resolve()
  private error: string | null = null
  private readonly fixture: OuterRuntime
  private readonly workspaceId: string
  private token: string
  private readonly command: (command: RunnerCommand) => void
  private readonly streamId: string

  constructor(
    fixture: OuterRuntime,
    workspaceId: string,
    token: string,
    command: (command: RunnerCommand) => void,
  ) {
    this.fixture = fixture
    this.workspaceId = workspaceId
    this.token = token
    this.command = command
    this.streamId = `browser-${workspaceId}`
  }

  status() {
    return {
      connected: this.welcomed,
      streamId: this.streamId,
      eventNumber: this.eventNumber,
      confirmedThrough: this.confirmedThrough,
      error: this.error,
    }
  }

  async start(token = this.token): Promise<void> {
    if (token !== this.token) {
      await this.stop()
      this.token = token
    }
    this.stopped = false
    if (this.socket?.readyState === WebSocket.READY_STATE_OPEN)
      return Promise.resolve()
    this.connecting ??= this.connect()
      .catch((error: unknown) => {
        if (!this.stopped) throw error
      })
      .finally(() => {
        this.connecting = undefined
      })
    return this.connecting
  }

  private async connect(): Promise<void> {
    const response = await requestRunner(this.fixture, this.token)
    const socket = response.webSocket
    if (response.status !== 101 || !socket) {
      if (this.stopped) return
      this.error = `The fake runner connection returned ${response.status}.`
      throw new Error(this.error)
    }
    this.socket = socket
    this.welcomed = false
    this.closed = new Promise<void>((resolve) => {
      socket.addEventListener(
        'close',
        () => {
          if (socket.readyState === WebSocket.READY_STATE_CLOSING)
            socket.close(1000, 'Connection closed.')
          const reconnect =
            this.welcomed && !this.stopped && this.error === null
          this.welcomed = false
          this.socket = undefined
          resolve()
          if (reconnect)
            void this.start().catch((error: unknown) => this.failed(error))
        },
        { once: true },
      )
    })
    socket.addEventListener('message', (event) => {
      if (this.stopped) return
      try {
        if (typeof event.data !== 'string')
          throw new Error('Expected a text runner command.')
        const input: unknown = JSON.parse(event.data)
        const message = readBrowserRunnerMessage(input, (warning) =>
          this.warnings.push(warning),
        )
        if (message.type === 'welcome') {
          this.welcomed = true
          this.error = null
          this.confirm(message.confirmedThrough)
          this.replay(this.confirmedThrough + 1)
          if (!this.readySent) {
            this.readySent = true
            this.emit({ type: 'runner.ready' })
          }
        } else if (message.type === 'confirm')
          this.confirm(message.throughEventNumber)
        else if (message.type === 'resend') this.replay(message.fromEventNumber)
        else this.command(message)
      } catch (error) {
        this.failed(error)
        socket.close(1011, 'The fake runner failed.')
      }
    })
    socket.accept()
    this.send({
      type: 'hello',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      workspaceId: this.workspaceId,
      streamId: this.streamId,
    })
    if (this.stopped) await this.stop()
  }

  private failed(error: unknown): void {
    this.error =
      error instanceof Error ? error.message : 'The fake runner failed.'
  }

  private confirm(through: number): void {
    this.confirmedThrough = Math.max(this.confirmedThrough, through)
    for (const number of this.outbox.keys())
      if (number <= through) this.outbox.delete(number)
  }

  private replay(from: number): void {
    for (const [number, event] of this.outbox)
      if (number >= from) this.send(event)
  }

  emit(event: RunnerEvent): void {
    const envelope: RunnerEventEnvelope = {
      type: 'event',
      streamId: this.streamId,
      eventNumber: ++this.eventNumber,
      occurredAt: Date.now(),
      event,
    }
    this.outbox.set(envelope.eventNumber, envelope)
    if (this.welcomed) this.send(envelope)
  }

  send(message: RunnerToWorkspace): void {
    if (this.socket?.readyState === WebSocket.READY_STATE_OPEN)
      this.socket.send(JSON.stringify(message))
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.socket?.close(1000, 'The fake sandbox stopped.')
    await this.closed
  }
}
