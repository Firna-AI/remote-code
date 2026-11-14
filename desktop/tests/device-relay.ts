import type { DevicePairing } from '../../src/shared/generated/DevicePairing.js'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'

import {
  DEVICE_FRAME_LIMIT_BYTES,
  DEVICE_HEARTBEAT_MS,
  DEVICE_OUTPUT_LIMIT_BYTES,
} from '../../src/shared/device.ts'
import type {
  DeviceCommandRef,
  DeviceToWorker,
  WorkerToDevice,
} from '../../src/shared/device.ts'

function matches(
  message: unknown,
  type: DeviceToWorker['type'],
  reference?: DeviceCommandRef,
): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === type &&
    (!reference ||
      ('workspaceId' in message &&
        message.workspaceId === reference.workspaceId &&
        'requestId' in message &&
        message.requestId === reference.requestId))
  )
}

function relayConnection(
  socket: WebSocket,
  device: DevicePairing,
  headers: Record<string, string | string[] | undefined>,
  address: string,
) {
  const messages: unknown[] = []
  const waiting: {
    type: DeviceToWorker['type']
    reference?: DeviceCommandRef
    resolve(value: unknown): void
  }[] = []
  const closed = once(socket, 'close')
  socket.on('message', (frame) => {
    const message: unknown = JSON.parse(frame.toString())
    if (matches(message, 'device.ping'))
      socket.send(
        JSON.stringify({ type: 'device.pong' } satisfies WorkerToDevice),
      )
    const index = waiting.findIndex((entry) =>
      matches(message, entry.type, entry.reference),
    )
    if (index === -1) messages.push(message)
    else waiting.splice(index, 1)[0].resolve(message)
  })
  return {
    device,
    headers,
    address,
    closed,
    send: (message: WorkerToDevice) => socket.send(JSON.stringify(message)),
    take(
      type: DeviceToWorker['type'],
      reference?: DeviceCommandRef,
    ): Promise<unknown> {
      const index = messages.findIndex((message) =>
        matches(message, type, reference),
      )
      if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0])
      return new Promise((resolve) =>
        waiting.push({ type, reference, resolve }),
      )
    },
  }
}

export async function deviceRelay() {
  const server = createServer()
  const websocket = new WebSocketServer({
    server,
    maxPayload: DEVICE_FRAME_LIMIT_BYTES,
    perMessageDeflate: false,
  })
  const connections: ReturnType<typeof relayConnection>[] = []
  const waiting = new Map<
    number,
    (connection: ReturnType<typeof relayConnection>) => void
  >()
  websocket.on('connection', (socket, request) => {
    const device = {
      deviceId:
        new URL(request.url ?? '/', 'http://relay.test').searchParams.get(
          'deviceId',
        ) ?? '',
      connectionId: `connection-${connections.length + 1}`,
    }
    const connection = relayConnection(
      socket,
      device,
      request.headers,
      request.url ?? '/',
    )
    connections.push(connection)
    connection.send({
      type: 'device.connected',
      device,
      outputLimitBytes: DEVICE_OUTPUT_LIMIT_BYTES,
      frameLimitBytes: DEVICE_FRAME_LIMIT_BYTES,
      heartbeatIntervalMs: DEVICE_HEARTBEAT_MS,
    })
    waiting.get(connections.length - 1)?.(connection)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Device relay did not listen')
  return {
    port: address.port,
    connection(index: number): Promise<ReturnType<typeof relayConnection>> {
      const existing = connections[index]
      return existing
        ? Promise.resolve(existing)
        : new Promise((resolve) => waiting.set(index, resolve))
    },
    async close() {
      websocket.clients.forEach((socket) => socket.terminate())
      websocket.close()
      server.close()
      await once(server, 'close')
    },
  }
}
