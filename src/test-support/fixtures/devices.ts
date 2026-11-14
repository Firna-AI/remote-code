import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import type { DeviceCommandResult } from '../../shared/generated/DeviceCommandResult'
import type { DevicePairing } from '../../shared/generated/DevicePairing'
import {
  alwaysAllowed,
  safariByFile,
  safariOutput,
  safariSuite,
  safariTest,
  thisMac,
  waitingWithScript,
} from '../../../docs/mockups/src/fixtures/mac'
import { checkoutAutocomplete } from '../../../docs/mockups/src/fixtures/workspaces'
import type {
  DeviceSettings,
  DeviceSettingsOutcome,
  DeviceSettingsResponse,
} from '../../shared/device'
import { FAKE_IDS, FAKE_TIME, fakeUser } from './core'

/** The pairing of the Mac app window on the Mac of the fake user. */
export const FAKE_PAIRING: DevicePairing = {
  deviceId: 'mac-cal',
  connectionId: 'connection-1',
}

/** The Mac commands that a fake workspace can hold. */
export type FakeMacScenario =
  | 'none'
  | 'waiting'
  | 'longer'
  | 'several'
  | 'many'
  | 'running'
  | 'denied'
  | 'done'
  | 'exit-code'
  | 'cut'
  | 'timed-out'
  | 'failed'
  | 'unavailable'
  | 'other-session'
  | 'literal'

/**
 * Commands that only a literal display shows as they are: a comment, then a
 * second command on its own line with a tab and two spaces, and a no-break
 * space before `#`, which the shell does not read as a comment.
 */
export const fakeLiteralCommands = [
  'printf safe # display comment\nprintf SECOND\tX  Y',
  'echo hi\u00A0#; echo RAN',
] as const

/** A run that started on the Mac at 6 s and ended `seconds` later. */
const ran = (seconds: number) => ({
  startedAt: FAKE_TIME + 6_000,
  updatedAt: FAKE_TIME + 6_000 + seconds * 1_000,
})

const passed: DeviceCommandResult = {
  stdout: safariOutput,
  stderr: '',
  exitCode: 0,
  timedOut: false,
  truncated: false,
}

/**
 * A stand-in for the key that the Worker gives a request ID: the SHA-256 of
 * the ID in unpadded base64url. The fake key is the ID itself in unpadded
 * base64url, so it differs from the ID and is safe in an address, as the
 * real key is. Addresses name a request by its key alone.
 */
function fakeRequestKey(requestId: string): string {
  const bytes = new TextEncoder().encode(requestId)
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/**
 * A request of the recorded turn, after its tool call starts, as the
 * Worker records it. The sender is the fake user, whose Mac is paired.
 * The key follows the request ID, unless `change` gives one.
 */
export function fakeMacRequest(
  change: Partial<DeviceCommandRecord> = {},
): DeviceCommandRecord {
  const requestId = change.requestId ?? 'mac-request-1'
  return {
    requestId,
    requestKey: fakeRequestKey(requestId),
    orgId: FAKE_IDS.org,
    workspaceId: FAKE_IDS.workspace,
    workspaceName: checkoutAutocomplete.name,
    sessionId: FAKE_IDS.session,
    turnId: 'turn-1',
    sender: {
      id: fakeUser.id,
      githubLogin: fakeUser.githubLogin,
      displayName: fakeUser.displayName,
      avatarUrl: fakeUser.avatarUrl,
    },
    device: FAKE_PAIRING,
    deviceName: thisMac.name,
    command: safariTest.command,
    folder: safariTest.folder,
    reason: safariTest.reason,
    timeoutSeconds: 60,
    longerTimeoutReason: null,
    state: 'waiting',
    result: null,
    error: null,
    createdAt: FAKE_TIME + 5_500,
    startedAt: null,
    updatedAt: FAKE_TIME + 5_500,
    ...change,
  }
}

const scenarios: Readonly<
  Record<FakeMacScenario, () => readonly DeviceCommandRecord[]>
> = {
  none: () => [],
  waiting: () => [fakeMacRequest()],
  longer: () => [
    fakeMacRequest({
      command: safariSuite.command,
      reason: safariSuite.reason,
      timeoutSeconds: 600,
      longerTimeoutReason: safariSuite.longerBecause ?? null,
    }),
  ],
  several: () => [
    fakeMacRequest(),
    fakeMacRequest({
      requestId: 'mac-request-2',
      command: 'sw_vers',
      reason: 'Read the macOS version for the bug report.',
      createdAt: FAKE_TIME + 5_800,
    }),
  ],
  many: () =>
    [safariByFile, ...waitingWithScript].map((request, index) =>
      fakeMacRequest({
        requestId: `mac-many-${index + 1}`,
        command: request.command,
        folder: request.folder,
        reason: request.reason,
        timeoutSeconds: request.longerBecause ? 600 : 60,
        longerTimeoutReason: request.longerBecause ?? null,
        createdAt: FAKE_TIME + 5_500 + index * 100,
      }),
    ),
  running: () => [fakeMacRequest({ state: 'running', ...ran(0) })],
  denied: () => [fakeMacRequest({ state: 'denied' })],
  done: () => [
    fakeMacRequest({ state: 'completed', result: passed, ...ran(16) }),
  ],
  'exit-code': () => [
    fakeMacRequest({
      ...ran(16),
      state: 'completed',
      result: {
        ...passed,
        stdout: '✗ checkout › suggests addresses (2.4s)\n1 failed (3.1s)',
        exitCode: 1,
      },
    }),
  ],
  cut: () => [
    fakeMacRequest({
      ...ran(16),
      state: 'completed',
      result: { ...passed, truncated: true },
    }),
  ],
  'timed-out': () => [
    fakeMacRequest({
      ...ran(60),
      state: 'timed-out',
      result: {
        stdout: '> storefront@2.4.0 test:safari',
        stderr: '',
        exitCode: null,
        timedOut: true,
        truncated: false,
      },
    }),
  ],
  failed: () => [
    fakeMacRequest({
      ...ran(3),
      state: 'failed',
      error: {
        code: 'turn_ended',
        message: 'The turn ended before the command finished.',
      },
    }),
  ],
  unavailable: () => [
    fakeMacRequest({ state: 'unavailable', device: null, deviceName: null }),
  ],
  'other-session': () => [fakeMacRequest({ sessionId: 'other-session' })],
  literal: () =>
    fakeLiteralCommands.map((command, index) =>
      fakeMacRequest({
        requestId: `mac-literal-${index + 1}`,
        command,
        createdAt: FAKE_TIME + 5_500 + index * 100,
      }),
    ),
}

/** The Mac command records of a scenario, the oldest first. */
export function fakeMacRequests(
  scenario: FakeMacScenario,
): readonly DeviceCommandRecord[] {
  return scenarios[scenario]()
}

/**
 * The settings of the fake Mac: its commands from the mockups, and the
 * 15 minutes of the fake workspace, with 14:32 left at `now`.
 */
export function fakeMacSettings(now = FAKE_TIME): DeviceSettings {
  return {
    deviceName: thisMac.name,
    alwaysAllowedCommands: [...alwaysAllowed],
    workspaceWindows: [
      {
        workspaceId: FAKE_IDS.workspace,
        workspaceName: checkoutAutocomplete.name,
        expiresAt: now + 14 * 60_000 + 32_000,
      },
    ],
  }
}

/**
 * The reply of the fake Mac to a read or a change of its settings: the
 * pairing, the settings after the operation, and its outcome. A read is
 * always done.
 */
export function fakeSettingsReply(
  settings: DeviceSettings = fakeMacSettings(),
  outcome: DeviceSettingsOutcome = { status: 'done' },
): DeviceSettingsResponse {
  return { ...FAKE_PAIRING, settings, outcome }
}
