import type { DeviceCommandResult } from './generated/DeviceCommandResult.js'
import type { DevicePairing } from './generated/DevicePairing.js'
import type { DeviceCommandRecord } from './generated/DeviceCommandRecord.js'
export const DEVICE_FRAME_LIMIT_BYTES = 1_000_000
/** Combined UTF-8 bytes of stdout and stderr. */
export const DEVICE_OUTPUT_LIMIT_BYTES = 65_536
export const DEVICE_HEARTBEAT_MS = 10_000
export const DEVICE_LEASE_MS = 30_000
export const DEVICE_REPLACED_CLOSE_CODE = 4001
export const DEVICE_REPLACED_CLOSE_REASON = 'This Mac connection was replaced.'
export const DEVICE_COMMAND_PATH = '/v1/tools/mac-command'
export const DEVICE_CURRENT_PATH = '/api/devices/current'
export const DEVICE_SETTINGS_PATH = `${DEVICE_CURRENT_PATH}/settings`

export function deviceConnectionPath(
  deviceId: string,
  deviceName?: string,
): string {
  const name =
    deviceName === undefined
      ? ''
      : `&deviceName=${encodeURIComponent(deviceName)}`
  return `/api/devices/connect?deviceId=${encodeURIComponent(deviceId)}${name}`
}
export function machineDeviceCommandPath(requestKey: string): string {
  return `${DEVICE_COMMAND_PATH}/${encodeURIComponent(requestKey)}`
}
export function deviceCommandsPath(orgId: string, workspaceId: string): string {
  return `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(workspaceId)}/device-commands`
}
export function deviceCommandPath(
  orgId: string,
  workspaceId: string,
  requestKey: string,
): string {
  return `${deviceCommandsPath(orgId, workspaceId)}/${encodeURIComponent(requestKey)}`
}
export function deviceApprovalPath(
  orgId: string,
  workspaceId: string,
  requestKey: string,
): string {
  return `${deviceCommandPath(orgId, workspaceId, requestKey)}/approval`
}
export interface DeviceCommandRef {
  workspaceId: string
  requestId: string
}

/** Process completion alone does not mean that the command succeeded. */
export function deviceCommandSucceeded(request: DeviceCommandRecord): boolean {
  return request.state === 'completed' && request.result?.exitCode === 0
}
export interface DeviceCommandsResponse {
  requests: readonly DeviceCommandRecord[]
}
export interface DeviceCurrentResponse {
  /** Present only for the desktop renderer session paired with this connection. */
  device: DevicePairing | null
}

export type DeviceApprovalAction =
  | 'deny'
  | 'allow'
  | 'always-allow'
  | 'allow-workspace-15-minutes'
  | 'allow-workspace-until-stop'
export interface DeviceApprovalRequest extends DevicePairing {
  action: DeviceApprovalAction
}
/** A grant: every command from one workspace runs on the Mac without asking. */
export interface DeviceWorkspaceWindow {
  workspaceId: string
  workspaceName: string | null
  /** The end of the 15 minutes, or null for a grant that runs until Stop. */
  expiresAt: number | null
}
/** The Worker relays this value. Only the Mac stores or applies these rules. */
export interface DeviceSettings {
  deviceName: string
  alwaysAllowedCommands: readonly string[]
  workspaceWindows: readonly DeviceWorkspaceWindow[]
}
export type DeviceSettingsAction =
  | { action: 'read' }
  | { action: 'remove-command'; command: string }
  | { action: 'stop-workspace'; workspaceId: string }
  | { action: 'extend-workspace'; workspaceId: string }
  /** Turns the running 15 minutes of a workspace into a grant until Stop. */
  | { action: 'keep-workspace'; workspaceId: string }
export interface DeviceSettingsRequest extends DevicePairing {
  operation: Exclude<DeviceSettingsAction, { action: 'read' }>
}
export type DeviceSettingsOutcome =
  | { status: 'done' }
  | { status: 'done-not-saved'; message: string }
  | { status: 'failed'; message: string }
export interface DeviceSettingsResponse extends DevicePairing {
  settings: DeviceSettings
  /** Reads return done. Changes report both application and persistence. */
  outcome: DeviceSettingsOutcome
}

/** The main process authenticates with HTTP headers, never with a JSON frame. */
export type WorkerToDevice =
  | {
      type: 'device.connected'
      device: DevicePairing
      outputLimitBytes: number
      frameLimitBytes: number
      heartbeatIntervalMs: number
    }
  | { type: 'device.pong' }
  | { type: 'command.request'; request: DeviceCommandRecord }
  | ({ type: 'command.cancel' } & DeviceCommandRef)
  | {
      type: 'command.approval'
      operationId: string
      requestId: string
      workspaceId: string
      action: DeviceApprovalAction
    }
  | {
      type: 'settings.operation'
      operationId: string
      operation: DeviceSettingsAction
    }

export type DeviceToWorker =
  | { type: 'device.ping' }
  | { type: 'device.sleep' }
  | ({ type: 'command.approved' } & DeviceCommandRef)
  | ({ type: 'command.denied' } & DeviceCommandRef)
  | {
      type: 'command.result'
      requestId: string
      workspaceId: string
      result: DeviceCommandResult
    }
  | ({ type: 'command.failed'; message: string } & DeviceCommandRef)
  | {
      type: 'settings.result'
      operationId: string
      settings: DeviceSettings
      outcome: DeviceSettingsOutcome
    }
  | {
      type: 'settings.failed'
      operationId: string
      code: 'settings_result_too_large'
    }
