import type { DeviceCommandRecord } from '../../../src/shared/generated/DeviceCommandRecord.js'
import type { DevicePairing } from '../../../src/shared/generated/DevicePairing.js'
import {
  DEVICE_FRAME_LIMIT_BYTES,
  DEVICE_HEARTBEAT_MS,
  DEVICE_OUTPUT_LIMIT_BYTES,
} from '../../../src/shared/device.ts'
import type {
  DeviceApprovalAction,
  DeviceSettingsAction,
  WorkerToDevice,
} from '../../../src/shared/device.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
function pairing(value: unknown): value is DevicePairing {
  return record(value) && text(value.deviceId) && text(value.connectionId)
}
function approval(value: unknown): value is DeviceApprovalAction {
  return (
    value === 'deny' ||
    value === 'allow' ||
    value === 'always-allow' ||
    value === 'allow-workspace-15-minutes' ||
    value === 'allow-workspace-until-stop'
  )
}
function operation(value: unknown): value is DeviceSettingsAction {
  return (
    record(value) &&
    (value.action === 'read' ||
      (value.action === 'remove-command' &&
        typeof value.command === 'string') ||
      ((value.action === 'stop-workspace' ||
        value.action === 'extend-workspace' ||
        value.action === 'keep-workspace') &&
        text(value.workspaceId)))
  )
}
function request(value: unknown): value is DeviceCommandRecord {
  if (!record(value) || !record(value.sender)) return false
  return (
    [
      value.requestId,
      value.requestKey,
      value.orgId,
      value.workspaceId,
      value.sessionId,
      value.turnId,
      value.sender.id,
      value.sender.githubLogin,
    ].every(text) &&
    nullableText(value.workspaceName) &&
    nullableText(value.sender.displayName) &&
    nullableText(value.sender.avatarUrl) &&
    pairing(value.device) &&
    nullableText(value.deviceName) &&
    typeof value.command === 'string' &&
    typeof value.folder === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.timeoutSeconds === 'number' &&
    nullableText(value.longerTimeoutReason) &&
    value.state === 'waiting' &&
    value.result === null &&
    value.error === null &&
    (value.startedAt === null ||
      (typeof value.startedAt === 'number' &&
        Number.isFinite(value.startedAt))) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  )
}

/** Narrow all untrusted JSON before it reaches policy or local execution. */
export function workerMessage(frame: string): WorkerToDevice | undefined {
  if (Buffer.byteLength(frame) > DEVICE_FRAME_LIMIT_BYTES) return
  let value: unknown
  try {
    value = JSON.parse(frame)
  } catch {
    return
  }
  if (!record(value)) return
  switch (value.type) {
    case 'device.connected':
      if (
        pairing(value.device) &&
        value.outputLimitBytes === DEVICE_OUTPUT_LIMIT_BYTES &&
        value.frameLimitBytes === DEVICE_FRAME_LIMIT_BYTES &&
        value.heartbeatIntervalMs === DEVICE_HEARTBEAT_MS
      )
        return {
          type: value.type,
          device: value.device,
          outputLimitBytes: value.outputLimitBytes,
          frameLimitBytes: value.frameLimitBytes,
          heartbeatIntervalMs: value.heartbeatIntervalMs,
        }
      return
    case 'device.pong':
      return { type: value.type }
    case 'command.request':
      if (request(value.request))
        return { type: value.type, request: value.request }
      return
    case 'command.cancel':
      if (text(value.workspaceId) && text(value.requestId))
        return {
          type: value.type,
          workspaceId: value.workspaceId,
          requestId: value.requestId,
        }
      return
    case 'command.approval':
      if (
        text(value.operationId) &&
        text(value.workspaceId) &&
        text(value.requestId) &&
        approval(value.action)
      )
        return {
          type: value.type,
          operationId: value.operationId,
          workspaceId: value.workspaceId,
          requestId: value.requestId,
          action: value.action,
        }
      return
    case 'settings.operation':
      if (text(value.operationId) && operation(value.operation))
        return {
          type: value.type,
          operationId: value.operationId,
          operation: value.operation,
        }
  }
}
