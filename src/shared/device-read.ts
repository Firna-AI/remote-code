import type { DeviceCommandInput } from './generated/DeviceCommandInput.js'
import type { DeviceCommandRecord } from './generated/DeviceCommandRecord.js'
import type { DeviceCommandResult } from './generated/DeviceCommandResult.js'
import type { DeviceCommandState } from './generated/DeviceCommandState.js'
import type { DevicePairing } from './generated/DevicePairing.js'
import {
  DEVICE_OUTPUT_LIMIT_BYTES,
  type DeviceSettings,
  type DeviceSettingsOutcome,
  type DeviceSettingsResponse,
} from './device.ts'

export class DeviceContractError extends Error {}

function isDeviceObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deviceObject(value: unknown): Record<string, unknown> {
  if (!isDeviceObject(value))
    throw new DeviceContractError('Send a valid Mac request.')
  return value
}
export function deviceText(value: unknown): string {
  if (typeof value !== 'string')
    throw new DeviceContractError('Complete the Mac request fields.')
  return value
}
export function deviceRequired(value: unknown): string {
  const text = deviceText(value)
  if (!text.trim())
    throw new DeviceContractError('Complete the Mac request fields.')
  return text
}
export function deviceNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new DeviceContractError('Send a valid Mac request number.')
  return value
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new DeviceContractError('Send a valid Mac result.')
  return value
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new DeviceContractError('Send a valid Mac list.')
  return value
}
function nullableText(value: unknown): string | null {
  return value === null ? null : deviceText(value)
}

/** Preserve exact text. Trimming is only a non-empty check. */
export function readDeviceCommandInput(value: unknown): DeviceCommandInput {
  const input = deviceObject(value)
  const timeoutSeconds =
    input.timeoutSeconds === undefined ? 60 : deviceNumber(input.timeoutSeconds)
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 1800
  )
    throw new DeviceContractError('Choose a time limit from 1 to 1800 seconds.')
  const longerTimeoutReason =
    input.longerTimeoutReason === undefined
      ? undefined
      : deviceText(input.longerTimeoutReason)
  if (timeoutSeconds > 120 && !longerTimeoutReason?.trim())
    throw new DeviceContractError(
      'Give a reason for a time limit above 120 seconds.',
    )
  const requestId = deviceRequired(input.requestId)
  return {
    requestId,
    command: deviceRequired(input.command),
    folder: deviceRequired(input.folder),
    reason: deviceRequired(input.reason),
    timeoutSeconds,
    ...(longerTimeoutReason !== undefined && { longerTimeoutReason }),
  }
}

export function readDevicePairing(value: unknown): DevicePairing {
  const input = deviceObject(value)
  return {
    deviceId: deviceRequired(input.deviceId),
    connectionId: deviceRequired(input.connectionId),
  }
}
export function readDeviceSettings(value: unknown): DeviceSettings {
  const input = deviceObject(value)
  return {
    deviceName: deviceRequired(input.deviceName),
    alwaysAllowedCommands: list(input.alwaysAllowedCommands).map(deviceText),
    workspaceWindows: list(input.workspaceWindows).map((value) => {
      const window = deviceObject(value)
      return {
        workspaceId: deviceRequired(window.workspaceId),
        workspaceName: nullableText(window.workspaceName),
        expiresAt:
          window.expiresAt === null ? null : deviceNumber(window.expiresAt),
      }
    }),
  }
}

export function readDeviceSettingsOutcome(
  value: unknown,
): DeviceSettingsOutcome {
  const input = deviceObject(value)
  if (input.status === 'done') return { status: 'done' }
  if (input.status === 'done-not-saved' || input.status === 'failed')
    return { status: input.status, message: deviceRequired(input.message) }
  throw new DeviceContractError('Send a valid Mac settings outcome.')
}

export function readDeviceSettingsResponse(
  value: unknown,
): DeviceSettingsResponse {
  const input = deviceObject(value)
  return {
    ...readDevicePairing(input),
    settings: readDeviceSettings(input.settings),
    outcome: readDeviceSettingsOutcome(input.outcome),
  }
}

export function readDeviceResult(value: unknown): DeviceCommandResult {
  const input = deviceObject(value)
  const exitCode = input.exitCode === null ? null : deviceNumber(input.exitCode)
  if (exitCode !== null && !Number.isInteger(exitCode))
    throw new DeviceContractError('Send a valid command exit code.')
  const stdout = deviceText(input.stdout)
  const stderr = deviceText(input.stderr)
  const encoder = new TextEncoder()
  const stdoutBytes = encoder.encode(stdout)
  const stderrBytes = encoder.encode(stderr)
  const take = (bytes: Uint8Array, limit: number) => {
    // A streaming decoder does not replace a final partial UTF-8 character.
    return new TextDecoder().decode(bytes.slice(0, Math.max(0, limit)), {
      stream: true,
    })
  }
  return {
    stdout: take(stdoutBytes, DEVICE_OUTPUT_LIMIT_BYTES),
    stderr: take(
      stderrBytes,
      DEVICE_OUTPUT_LIMIT_BYTES -
        Math.min(stdoutBytes.length, DEVICE_OUTPUT_LIMIT_BYTES),
    ),
    exitCode,
    timedOut: boolean(input.timedOut),
    truncated:
      boolean(input.truncated) ||
      stdoutBytes.length + stderrBytes.length > DEVICE_OUTPUT_LIMIT_BYTES,
  }
}

export function readDeviceState(value: unknown): DeviceCommandState {
  switch (value) {
    case 'waiting':
    case 'running':
    case 'completed':
    case 'denied':
    case 'unavailable':
    case 'timed-out':
    case 'failed':
      return value
    default:
      throw new DeviceContractError('Send a valid Mac command state.')
  }
}
export function readDeviceRecord(value: unknown): DeviceCommandRecord {
  const input = deviceObject(value)
  const command = readDeviceCommandInput({
    ...input,
    longerTimeoutReason: input.longerTimeoutReason ?? undefined,
  })
  const sender = deviceObject(input.sender)
  const error = input.error === null ? null : deviceObject(input.error)
  return {
    ...command,
    requestKey: deviceRequired(input.requestKey),
    timeoutSeconds: command.timeoutSeconds ?? 60,
    longerTimeoutReason:
      input.longerTimeoutReason === null
        ? null
        : deviceText(input.longerTimeoutReason),
    orgId: deviceRequired(input.orgId),
    workspaceId: deviceRequired(input.workspaceId),
    workspaceName: nullableText(input.workspaceName),
    sessionId: deviceRequired(input.sessionId),
    turnId: deviceRequired(input.turnId),
    sender: {
      id: deviceRequired(sender.id),
      githubLogin: deviceText(sender.githubLogin),
      displayName: nullableText(sender.displayName),
      avatarUrl: nullableText(sender.avatarUrl),
    },
    device: input.device === null ? null : readDevicePairing(input.device),
    deviceName: nullableText(input.deviceName),
    state: readDeviceState(input.state),
    result: input.result === null ? null : readDeviceResult(input.result),
    error:
      error === null
        ? null
        : { code: deviceText(error.code), message: deviceText(error.message) },
    createdAt: deviceNumber(input.createdAt),
    startedAt: input.startedAt === null ? null : deviceNumber(input.startedAt),
    updatedAt: deviceNumber(input.updatedAt),
  }
}
