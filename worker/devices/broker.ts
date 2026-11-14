import type { DevicePairing } from '../../src/shared/generated/DevicePairing'
import {
  DEVICE_FRAME_LIMIT_BYTES,
  DEVICE_HEARTBEAT_MS,
  DEVICE_OUTPUT_LIMIT_BYTES,
  DEVICE_REPLACED_CLOSE_CODE,
  DEVICE_REPLACED_CLOSE_REASON,
  type DeviceSettingsAction,
} from '../../src/shared/device'
import {
  deviceObject,
  readDevicePairing,
  readDeviceRecord,
} from '../../src/shared/device-read'
import type { ChatStorage } from '../chat/types'
import type { AppEnv } from '../env'
import { HttpError } from '../http'
import type {
  BrokerRequest,
  DeviceConnection,
  SettingsWaiter,
} from './broker-types'
import { deviceCall } from './internal'
import { receiveDeviceMessage } from './broker-messages'
import { deviceWire } from './socket'
import { relayDeviceSettings } from './broker-settings'
import { BrokerRequests } from './broker-store'
import { checkBroker, dropBroker, scheduleBroker } from './broker-lifecycle'

export class DeviceBroker {
  connection: DeviceConnection | null = null
  readonly settings = new Map<string, SettingsWaiter>()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly requests: BrokerRequests
  readonly env: AppEnv
  readonly now: () => number
  readonly alarm: (when: number | null) => Promise<void>

  constructor(
    storage: ChatStorage,
    env: AppEnv,
    alarm: (when: number | null) => Promise<void>,
    now: () => number = Date.now,
  ) {
    this.env = env
    this.now = now
    this.alarm = alarm
    this.requests = new BrokerRequests(storage)
  }

  serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.tail.then(work)
    this.tail = task.catch(() => undefined)
    return task
  }
  pending(): Promise<BrokerRequest[]> {
    return this.requests.pending()
  }
  async store(item: BrokerRequest): Promise<void> {
    await this.requests.store(item)
    await scheduleBroker(this)
  }
  forget(item: BrokerRequest): Promise<void> {
    return this.requests.forget(item)
  }
  async valid(item: BrokerRequest): Promise<boolean> {
    try {
      const reply = deviceObject(
        await deviceCall(this.env, item.request.workspaceId, {
          type: 'workspace.validate',
          requestId: item.request.requestId,
          tokenHash: item.tokenHash,
        }),
      )
      return reply.valid === true
    } catch {
      return false
    }
  }
  async invalid(item: BrokerRequest): Promise<void> {
    let reply: Record<string, unknown>
    try {
      reply = deviceObject(
        await deviceCall(this.env, item.request.workspaceId, {
          type: 'workspace.validate',
          requestId: item.request.requestId,
          tokenHash: item.tokenHash,
        }),
      )
    } catch {
      return this.unavailable(item)
    }
    if (reply.reason !== 'turn_ended') return this.unavailable(item)
    try {
      this.connection?.send({
        type: 'command.cancel',
        workspaceId: item.request.workspaceId,
        requestId: item.request.requestId,
      })
    } catch {
      /* Still settle and forget work after transport loss. */
    }
    try {
      await this.update(item, {
        state: 'failed',
        error: { code: 'turn_ended', message: 'The agent turn has ended.' },
      })
    } catch {
      /* Deleted workspace state cannot block unrelated work. */
    } finally {
      await this.forget(item)
    }
  }
  async update(item: BrokerRequest, update: Record<string, unknown>) {
    const reply = await deviceCall(this.env, item.request.workspaceId, {
      type: 'workspace.update',
      requestId: item.request.requestId,
      device: item.request.device,
      desktopSessionId: item.sessionId,
      ...update,
    })
    return readDeviceRecord(deviceObject(reply).request)
  }
  async unavailable(item: BrokerRequest): Promise<void> {
    try {
      this.connection?.send({
        type: 'command.cancel',
        requestId: item.request.requestId,
        workspaceId: item.request.workspaceId,
      })
    } catch {
      /* The Mac may already be offline. */
    }
    try {
      await this.update(item, { state: 'unavailable' })
    } catch {
      /* A deleted workspace has no request left to settle. */
    } finally {
      await this.forget(item)
    }
  }
  drop(code = 1000, reason = 'The Mac is not available.'): Promise<void> {
    return dropBroker(this, code, reason)
  }
  check(): Promise<boolean> {
    return checkBroker(this)
  }
  async attach(connection: DeviceConnection): Promise<void> {
    await this.drop(DEVICE_REPLACED_CLOSE_CODE, DEVICE_REPLACED_CLOSE_REASON)
    this.connection = connection
    connection.send({
      type: 'device.connected',
      device: connection.device,
      outputLimitBytes: DEVICE_OUTPUT_LIMIT_BYTES,
      frameLimitBytes: DEVICE_FRAME_LIMIT_BYTES,
      heartbeatIntervalMs: DEVICE_HEARTBEAT_MS,
    })
    connection.nextCheckAt = this.now() + DEVICE_HEARTBEAT_MS
    await connection.persist?.()
    await scheduleBroker(this)
  }
  async current(
    userId: string,
    sessionId: string,
  ): Promise<DevicePairing | null> {
    if (!(await this.check())) return null
    return this.connection?.userId === userId &&
      this.connection.sessionId === sessionId
      ? this.connection.device
      : null
  }
  async dispatch(value: unknown, tokenHash: string): Promise<boolean> {
    const request = readDeviceRecord(value)
    if (
      !(await this.check()) ||
      !this.connection ||
      !request.device ||
      this.connection.userId !== request.sender.id ||
      this.connection.device.connectionId !== request.device.connectionId ||
      this.connection.device.deviceId !== request.device.deviceId
    )
      return false
    const item: BrokerRequest = {
      request,
      tokenHash,
      sessionId: this.connection.sessionId,
      executionDeadline: null,
    }
    if (!(await this.valid(item))) return false
    if (await this.requests.has(request)) return true
    deviceWire({ type: 'command.request', request })
    await this.store(item)
    const claim = deviceObject(
      await deviceCall(this.env, request.workspaceId, {
        type: 'workspace.claim',
        requestId: request.requestId,
        device: request.device,
        desktopSessionId: item.sessionId,
        tokenHash,
      }),
    )
    if (claim.claimed !== true) {
      await this.forget(item)
      return false
    }
    this.connection.send({ type: 'command.request', request })
    return true
  }
  requirePairing(
    value: unknown,
    userId: string,
    sessionId: string,
  ): DeviceConnection {
    const pairing = readDevicePairing(value)
    const connection = this.connection
    if (
      !connection ||
      connection.userId !== userId ||
      connection.sessionId !== sessionId ||
      connection.device.connectionId !== pairing.connectionId ||
      connection.device.deviceId !== pairing.deviceId
    )
      throw new HttpError(
        403,
        'device_forbidden',
        'Open this request on the connected Mac.',
      )
    return connection
  }
  relaySettings(connection: DeviceConnection, operation: DeviceSettingsAction) {
    return relayDeviceSettings(this.settings, connection, operation)
  }
  receive(connection: DeviceConnection, value: unknown): Promise<void> {
    return this.serial(async () => {
      if (this.connection !== connection) return
      try {
        await receiveDeviceMessage(this, connection, value)
      } catch {
        await this.drop()
      }
    })
  }
}
