import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord'
import type { DevicePairing } from '../../src/shared/generated/DevicePairing'
import type {
  DeviceSettingsResponse,
  WorkerToDevice,
} from '../../src/shared/device'

export interface DeviceConnection {
  device: DevicePairing
  deviceName: string | null
  userId: string
  sessionId: string
  lastSeen: number
  nextCheckAt?: number
  heartbeatAt?(): number | null
  persist?(): Promise<void>
  retire?(): Promise<void>
  send(message: WorkerToDevice): void
  close(code?: number, reason?: string): void
}
export interface BrokerRequest {
  request: DeviceCommandRecord
  tokenHash: string
  sessionId: string
  executionDeadline: number | null
}
export interface SettingsWaiter {
  connectionId: string
  resolve(value: DeviceSettingsResponse): void
  reject(error: Error): void
  cancel(): void
}
