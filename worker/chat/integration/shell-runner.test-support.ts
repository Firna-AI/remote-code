import { WebSocket } from 'miniflare'
import type { RunnerEvent } from '../../../src/shared/generated/RunnerEvent'
import { SocketInbox } from '../adapter-sockets.test-support'
import type { OuterRuntime } from './outer-runtime.test-support'
import { requestRunner } from './runner-socket.test-support'

export async function connectShellRunner(
  fixture: OuterRuntime,
  workspaceId: string,
  token: string,
  streamId: string,
) {
  const response = await requestRunner(fixture, token)
  const socket = response.webSocket
  if (response.status !== 101 || !socket)
    throw new Error(`The runner connection returned ${response.status}.`)
  const inbox = new SocketInbox(socket)
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
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
  socket.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: 2,
      workspaceId,
      streamId,
    }),
  )
  let eventNumber = 0
  return {
    socket,
    inbox,
    closed,
    emit(event: RunnerEvent) {
      socket.send(
        JSON.stringify({
          type: 'event',
          streamId,
          eventNumber: ++eventNumber,
          occurredAt: 1_800_000_000_000 + eventNumber,
          event,
        }),
      )
    },
  }
}
