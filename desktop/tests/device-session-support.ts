import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord.js'
import { onTestFinished, vi } from 'vitest'

import type { DeviceToWorker } from '../../src/shared/device.ts'
import { createPermissionStore } from '../src/device/permissions.js'
import type { CommandOutcome, CommandRun } from '../src/device/runner.js'
import { createDeviceSession } from '../src/device/session.js'
import { command, fakeClock, memoryFiles } from './device-support.js'

export function sessionFixture() {
  const time = fakeClock()
  const { files } = memoryFiles()
  const permissions = createPermissionStore({
    userId: 'user-one',
    deviceName: 'Cals-Mac.local',
    files,
    clock: time.clock,
    warn: vi.fn(),
  })
  const sent: DeviceToWorker[] = []
  const pending: {
    request: DeviceCommandRecord
    cancel: ReturnType<typeof vi.fn>
    finish(outcome: CommandOutcome): void
  }[] = []
  const run = vi.fn<(request: DeviceCommandRecord) => CommandRun>((request) => {
    let resolve: (outcome: CommandOutcome) => void = () => {
      throw new Error('Missing command')
    }
    const result = new Promise<CommandOutcome>((done) => {
      resolve = done
    })
    const cancel = vi.fn()
    pending.push({ request, cancel, finish: resolve })
    return { result, cancel }
  })
  const dismiss = vi.fn()
  const notify = vi.fn(() => dismiss)
  const invalid = vi.fn()
  const warn = vi.fn()
  const session = createDeviceSession({
    userId: 'user-one',
    pairing: { deviceId: 'local-device', connectionId: 'connection-one' },
    permissions,
    run,
    send: (message) => {
      sent.push(message)
      return true
    },
    notify,
    invalid,
    warn,
  })
  onTestFinished(() => {
    session.dispose()
    permissions.dispose()
  })
  return {
    ...time,
    session,
    sent,
    pending,
    run,
    notify,
    invalid,
    dismiss,
    permissions,
    files,
    warn,
    command,
  }
}

export const successfulResult: CommandOutcome = {
  type: 'result',
  result: {
    stdout: 'done',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
  },
}
