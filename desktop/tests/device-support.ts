import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord.js'
import { createHash } from 'node:crypto'

import type { DeviceClock } from '../src/device/clock.js'
import type { DeviceFiles } from '../src/device/files.js'

export function fakeClock(start = 1_800_000_000_000) {
  let current = start
  let next = 0
  const timers = new Map<number, { at: number; callback(): void }>()
  const clock: DeviceClock = {
    now: () => current,
    after: (milliseconds, callback) => {
      const id = ++next
      timers.set(id, { at: current + milliseconds, callback })
      return () => timers.delete(id)
    },
  }
  return {
    clock,
    advance(milliseconds: number) {
      const end = current + milliseconds
      for (;;) {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry || entry[1].at > end) break
        timers.delete(entry[0])
        current = entry[1].at
        entry[1].callback()
      }
      current = end
    },
    timers,
  }
}

export function memoryFiles() {
  const contents = new Map<string, string>()
  const files: DeviceFiles = {
    read: (name) => contents.get(name),
    write: (name, value) => void contents.set(name, value),
  }
  return { files, contents }
}

export function command(
  changes: Partial<DeviceCommandRecord> = {},
): DeviceCommandRecord {
  const requestId = changes.requestId ?? 'request-one'
  return {
    requestId,
    requestKey: createHash('sha256').update(requestId).digest('base64url'),
    orgId: 'org-one',
    workspaceId: 'workspace-one',
    workspaceName: 'Checkout address',
    sessionId: 'session-one',
    turnId: 'turn-one',
    sender: {
      id: 'user-one',
      githubLogin: 'cal',
      displayName: 'Cal',
      avatarUrl: null,
    },
    device: { deviceId: 'local-device', connectionId: 'connection-one' },
    deviceName: 'Cals-Mac.local',
    command: 'printf hello',
    folder: '/Users/cal/project',
    reason: 'Read local build output.',
    timeoutSeconds: 60,
    longerTimeoutReason: null,
    state: 'waiting',
    result: null,
    error: null,
    startedAt: null,
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    ...changes,
  }
}
