import { WebSocket } from 'miniflare'
import type { RunnerEvent } from '../../../src/shared/generated/RunnerEvent'
import type { RunnerEventEnvelope } from '../../../src/shared/generated/RunnerEventEnvelope'
import type { RunnerToWorkspace } from '../../../src/shared/generated/RunnerToWorkspace'
import type { RunnerProtocolVersion } from '../../../src/shared/generated/RunnerProtocolVersion'
import { MACHINE_PATHS } from '../../../src/shared/agent-tools'
import { SocketInbox } from '../adapter-sockets.test-support'
import {
  OUTER_MACHINE_ORIGIN,
  type OuterRuntime,
} from './outer-runtime.test-support'
import { OUTER_TOKEN, OUTER_WORKSPACE } from './outer-seed.test-support'

export function requestRunner(
  fixture: OuterRuntime,
  token: string | null = OUTER_TOKEN,
) {
  return fixture.runtime.dispatchFetch(
    `${OUTER_MACHINE_ORIGIN}${MACHINE_PATHS.runner}`,
    {
      headers: {
        Upgrade: 'websocket',
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      },
    },
  )
}

export class OuterFakeRunner {
  readonly socket: WebSocket
  readonly inbox: SocketInbox
  readonly received: unknown[] = []
  readonly closed: Promise<{ code: number; reason: string }>
  private eventNumber = 0
  private readonly streamId: string

  constructor(
    socket: WebSocket,
    workspaceId = OUTER_WORKSPACE,
    options: {
      streamId?: string
      eventNumber?: number
      protocolVersion?: RunnerProtocolVersion
    } = {},
  ) {
    this.streamId = options.streamId ?? 'outer-runner-stream'
    this.eventNumber = options.eventNumber ?? 0
    this.socket = socket
    this.inbox = new SocketInbox(socket)
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string')
        throw new Error('Expected a text socket message.')
      const message: unknown = JSON.parse(event.data)
      this.received.push(message)
    })
    this.closed = new Promise((resolve) => {
      socket.addEventListener(
        'close',
        (event) => {
          if (socket.readyState === WebSocket.READY_STATE_CLOSING)
            socket.close(1000, 'Connection closed.')
          resolve({ code: event.code, reason: event.reason })
        },
        { once: true },
      )
    })
    socket.accept()
    this.send({
      type: 'hello',
      protocolVersion: options.protocolVersion ?? 2,
      workspaceId,
      streamId: this.streamId,
    })
  }

  emit(event: RunnerEvent): RunnerEventEnvelope {
    const envelope: RunnerEventEnvelope = {
      type: 'event',
      streamId: this.streamId,
      eventNumber: ++this.eventNumber,
      occurredAt: 1_800_000_000_000 + this.eventNumber,
      event,
    }
    this.send(envelope)
    return envelope
  }

  resend(envelope: RunnerEventEnvelope): void {
    this.send(envelope)
  }

  private send(message: RunnerToWorkspace): void {
    this.socket.send(JSON.stringify(message))
  }
}
