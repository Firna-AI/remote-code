import type { RunnerCommand } from '../../src/shared/generated/RunnerCommand'
import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import type { RunnerEventEnvelope } from '../../src/shared/generated/RunnerEventEnvelope'
import type { WorkspaceToRunner } from '../../src/shared/generated/WorkspaceToRunner'
import type { RunnerProtocolVersion } from '../../src/shared/generated/RunnerProtocolVersion'
import type { RunnerLoginKind } from '../../src/shared/generated/RunnerLoginKind'
import type { RunnerFileResponse } from '../../src/shared/generated/RunnerFileResponse'
import type {
  RunnerConnection,
  RunnerConnectionRequest,
  RunnerConnector,
} from '../../src/shared/runner-transport'

export interface FakeRunnerOptions {
  workspaceId: string
  streamId?: string
  now?: () => number
  protocolVersion?: RunnerProtocolVersion
  loginKinds?: readonly RunnerLoginKind[]
}

/**
 * Backend tests drive emit() in place of SDK output and inspect commands.
 * It has no agent SDK, sandbox, network, or credential persistence.
 */
export class FakeRunner {
  readonly commands: RunnerCommand[] = []
  readonly received: WorkspaceToRunner[] = []
  private readonly outbox = new Map<number, RunnerEventEnvelope>()
  private connection: RunnerConnection | null = null
  private sequence = 0
  private readonly streamId: string
  private readonly now: () => number
  private readonly options: FakeRunnerOptions

  constructor(options: FakeRunnerOptions) {
    this.options = options
    this.streamId = options.streamId ?? 'fake-stream-1'
    this.now = options.now ?? (() => 1_800_000_000_000)
  }

  async connect(
    connector: RunnerConnector,
    request: RunnerConnectionRequest,
  ): Promise<void> {
    this.disconnect()
    const connection = await connector(request)
    this.connection = connection
    connection.onMessage((message) => this.receive(message))
    connection.onClose(() => {
      if (this.connection === connection) this.connection = null
    })
    connection.send({
      type: 'hello',
      protocolVersion: this.options.protocolVersion ?? 2,
      workspaceId: this.options.workspaceId,
      streamId: this.streamId,
      ...(this.options.loginKinds
        ? { loginKinds: this.options.loginKinds }
        : {}),
    })
  }

  disconnect(): void {
    this.connection?.close()
    this.connection = null
  }

  emit(event: RunnerEvent): RunnerEventEnvelope {
    const envelope: RunnerEventEnvelope = {
      type: 'event',
      streamId: this.streamId,
      eventNumber: ++this.sequence,
      occurredAt: this.now(),
      event: structuredClone(event),
    }
    this.outbox.set(envelope.eventNumber, envelope)
    this.connection?.send(envelope)
    return structuredClone(envelope)
  }

  pendingEvents(): readonly RunnerEventEnvelope[] {
    return structuredClone([...this.outbox.values()])
  }

  reply(response: RunnerFileResponse): void {
    if (!this.connection)
      throw new Error('Connect the fake runner before replying.')
    this.connection.send(response)
  }

  /** Send an explicit duplicate or gap when testing a backend's event reader. */
  sendEnvelope(envelope: RunnerEventEnvelope): void {
    if (!this.connection)
      throw new Error('Connect the fake runner before sending.')
    this.connection.send(envelope)
  }

  private receive(message: WorkspaceToRunner): void {
    this.received.push(structuredClone(message))
    if (message.type === 'confirm' || message.type === 'welcome') {
      const through =
        message.type === 'confirm'
          ? message.throughEventNumber
          : message.confirmedThrough
      for (const eventNumber of this.outbox.keys()) {
        if (eventNumber <= through) this.outbox.delete(eventNumber)
      }
      if (message.type === 'welcome') this.resend(through + 1)
    } else if (message.type === 'resend') {
      this.resend(message.fromEventNumber)
    } else {
      this.commands.push(message)
    }
  }

  private resend(from: number): void {
    for (const envelope of [...this.outbox.values()]) {
      if (envelope.eventNumber >= from) this.connection?.send(envelope)
    }
  }
}
