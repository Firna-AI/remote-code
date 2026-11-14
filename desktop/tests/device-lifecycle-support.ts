import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord.js'
import { EventEmitter } from 'node:events'
import { onTestFinished, vi } from 'vitest'
import { WebSocket } from 'ws'

import {
  DEVICE_FRAME_LIMIT_BYTES,
  DEVICE_HEARTBEAT_MS,
  DEVICE_OUTPUT_LIMIT_BYTES,
} from '../../src/shared/device.ts'
import type { WorkerToDevice } from '../../src/shared/device.ts'
import { createDeviceConnection } from '../src/device/connection.js'
import { createPermissionStore } from '../src/device/permissions.js'
import type { ProcessEvents } from '../src/device/process.js'
import { createDeviceSessionFactory } from '../src/device/session-factory.js'
import { connectDevice } from '../src/device/transport.js'
import { command, fakeClock, memoryFiles } from './device-support.js'

class Wire extends EventEmitter {
  readyState: WebSocket['readyState'] = WebSocket.OPEN
  bufferedAmount = 0
  send = vi.fn((_frame: string, callback: (error?: Error) => void): void =>
    callback(),
  )
  terminate = vi.fn()
}

export function deviceLifecycleFixture() {
  const time = fakeClock()
  const { files } = memoryFiles()
  const warn = vi.fn()
  const notify = vi.fn<(request: DeviceCommandRecord) => () => void>(() =>
    vi.fn(),
  )
  const invalid = vi.fn()
  const closed = vi.fn()
  const wires: Wire[] = []
  const processes: {
    command: string
    folder: string
    events: ProcessEvents
    kill: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }[] = []
  let userId = 'user-one'
  let signedIn = true
  const sessions = createDeviceSessionFactory({
    files,
    clock: time.clock,
    deviceName: 'Cals-Mac.local',
    warn,
    notify,
    launch: (command, folder, events) => {
      const process = {
        command,
        folder,
        events,
        kill: vi.fn(),
        dispose: vi.fn(),
      }
      processes.push(process)
      return process
    },
  })
  const connection = createDeviceConnection({
    deviceId: 'local-device',
    clock: time.clock,
    readCredential: async () =>
      signedIn
        ? {
            value: 'fixture.signature',
            expiresAt: time.clock.now() + 1_000_000,
          }
        : undefined,
    authenticate: async () => ({ userId, appAccess: true }),
    connect: (credential, events) => {
      const wire = new Wire()
      wires.push(wire)
      return connectDevice(
        {
          appOrigin: 'https://app.conductive.test',
          deviceId: 'local-device',
          credential,
          events: {
            message: events.message,
            closed: (rejected) => {
              closed(rejected)
              events.closed(rejected)
            },
          },
        },
        () => wire,
      )
    },
    session: (userId, pairing, send, reject) =>
      sessions.session(userId, pairing, send, () => {
        invalid()
        reject()
      }),
    signedOut: sessions.signedOut,
    warn,
  })
  const receive = (message: WorkerToDevice) =>
    wires.at(-1)?.emit('message', Buffer.from(JSON.stringify(message)), false)
  const pairing = () => ({
    deviceId: 'local-device',
    connectionId: `connection-${wires.length}`,
  })
  const pair = () =>
    receive({
      type: 'device.connected',
      device: pairing(),
      outputLimitBytes: DEVICE_OUTPUT_LIMIT_BYTES,
      frameLimitBytes: DEVICE_FRAME_LIMIT_BYTES,
      heartbeatIntervalMs: DEVICE_HEARTBEAT_MS,
    })
  const stop = () => {
    connection.stop()
    sessions.dispose()
  }
  onTestFinished(stop)
  return {
    ...time,
    files,
    warn,
    notify,
    invalid,
    closed,
    processes,
    connection,
    sessions,
    receive,
    pair,
    stop,
    async start() {
      await connection.start()
      pair()
    },
    /** Removes the sign-in cookie, as a sign-out does. */
    async signOut() {
      signedIn = false
      await connection.cookieChanged()
    },
    async signIn(nextUserId: string) {
      userId = nextUserId
      signedIn = true
      await connection.cookieChanged()
      pair()
    },
    command(changes: Partial<DeviceCommandRecord> = {}) {
      const request = command(changes)
      return {
        ...request,
        sender: { ...request.sender, id: userId },
        device: pairing(),
      }
    },
    openPermissions: (accountId = 'user-one') =>
      createPermissionStore({
        files,
        clock: time.clock,
        deviceName: 'Cals-Mac.local',
        userId: accountId,
        warn,
      }),
    messages: () =>
      wires.flatMap((wire) =>
        wire.send.mock.calls.map(([frame]) => {
          const message: unknown = JSON.parse(frame)
          return message
        }),
      ),
  }
}
