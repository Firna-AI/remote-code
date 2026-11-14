import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord.js'
import { EventEmitter } from 'node:events'
import { onTestFinished, vi } from 'vitest'
import { WebSocket } from 'ws'

import type { WorkerToDevice } from '../../src/shared/device.ts'
import { createPermissionStore } from '../src/device/permissions.js'
import type { ProcessEvents } from '../src/device/process.js'
import { runCommand } from '../src/device/runner.js'
import { createDeviceSession } from '../src/device/session.js'
import { connectDevice } from '../src/device/transport.js'
import { fakeClock, memoryFiles } from './device-support.js'

class Wire extends EventEmitter {
  readyState: WebSocket['readyState'] = WebSocket.OPEN
  bufferedAmount = 0
  send = vi.fn((_frame: string, callback: (error?: Error) => void): void =>
    callback(),
  )
  terminate = vi.fn()
}

export function deviceSettingsFixture(savedCommands: readonly string[] = []) {
  const time = fakeClock()
  const { files } = memoryFiles()
  const read = files.read
  // Legacy permission files can exceed the current save budget.
  files.read = (name) =>
    read(name) ??
    JSON.stringify({
      alwaysAllowedCommands: savedCommands,
      workspaceWindows: [],
    })
  const warn = vi.fn()
  const openPermissions = () =>
    createPermissionStore({
      userId: 'user-one',
      deviceName: 'Cals-Mac.local',
      files,
      clock: time.clock,
      warn,
    })
  const permissions = openPermissions()
  const processes: {
    request: DeviceCommandRecord
    events: ProcessEvents
    kill: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }[] = []
  const wire = new Wire()
  const notify = vi.fn(() => vi.fn())
  const invalid = vi.fn()
  const closed = vi.fn(() => session.dispose())
  const socket = connectDevice(
    {
      appOrigin: 'https://app.conductive.test',
      deviceId: 'local-device',
      credential: 'fixture.signature',
      events: { message: (message) => session.receive(message), closed },
    },
    () => wire,
  )
  const session = createDeviceSession({
    userId: 'user-one',
    pairing: { deviceId: 'local-device', connectionId: 'connection-one' },
    permissions,
    send: socket.send,
    notify,
    invalid,
    warn,
    run: (request) =>
      runCommand(request, {
        clock: time.clock,
        launch: (_command, _folder, events) => {
          const process = {
            request,
            events,
            kill: vi.fn(),
            dispose: vi.fn(),
          }
          processes.push(process)
          return process
        },
      }),
  })
  onTestFinished(() => {
    socket.close()
    permissions.dispose()
  })
  return {
    ...time,
    files,
    permissions,
    openPermissions,
    processes,
    wire,
    notify,
    invalid,
    warn,
    closed,
    receive: (message: WorkerToDevice) =>
      wire.emit('message', Buffer.from(JSON.stringify(message)), false),
    messages: () =>
      wire.send.mock.calls.map(([frame]) => {
        const message: unknown = JSON.parse(frame)
        return message
      }),
  }
}
