import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord'

import {
  deviceObject,
  deviceRequired,
  readDevicePairing,
  readDeviceResult,
  readDeviceState,
} from '../../src/shared/device-read'
import type { WorkspaceChat } from '../chat/backend'
import type { ChatStorage } from '../chat/types'
import type { AppEnv } from '../env'
import { HttpError } from '../http'
import { activeDeviceSender, desktopSessionAlive } from './access'
import { deviceCall, type DeviceOperationValue } from './internal'
import { deviceBrokerName } from './paths'
import { commandPending, DeviceRecords } from './records'
import { workspaceMachine } from './workspace-machine'
import type { DeviceStateProjection } from './state'

export class WorkspaceDevices {
  readonly records: DeviceRecords
  readonly chat: WorkspaceChat
  readonly env: AppEnv
  readonly matches: (name: string) => boolean
  readonly now: () => number
  constructor(
    chat: WorkspaceChat,
    env: AppEnv,
    storage: ChatStorage,
    matches: (name: string) => boolean,
    now: () => number,
    projection?: DeviceStateProjection,
  ) {
    this.chat = chat
    this.env = env
    this.matches = matches
    this.now = now
    this.records = new DeviceRecords(storage, chat, env, now, projection)
  }
  machine(request: Request): Promise<Response> {
    return workspaceMachine(this, request)
  }
  async validation(record: DeviceCommandRecord, tokenHash: string) {
    if ((await this.records.tokenHash(record.requestId)) !== tokenHash)
      return { valid: false, reason: 'access_revoked' }
    try {
      const active = await activeDeviceSender(
        this.chat,
        this.env,
        record.workspaceId,
        record.turnId,
        tokenHash,
      )
      return {
        valid:
          active.sender.id === record.sender.id &&
          active.sessionId === record.sessionId,
        reason: 'access_revoked',
      }
    } catch (error) {
      return {
        valid: false,
        reason:
          error instanceof HttpError && error.code === 'calling_turn_required'
            ? 'turn_ended'
            : 'access_revoked',
      }
    }
  }
  fail(id: string, reason: string) {
    return this.records.change(id, async (record) =>
      commandPending(record)
        ? {
            ...record,
            state: reason === 'turn_ended' ? 'failed' : 'unavailable',
            updatedAt: this.now(),
            error: {
              code: reason,
              message:
                reason === 'turn_ended'
                  ? 'The agent turn has ended.'
                  : 'The Mac is not available.',
            },
          }
        : record,
    )
  }
  async refresh(record: DeviceCommandRecord): Promise<void> {
    if (!commandPending(record)) return
    const check = await this.validation(
      record,
      await this.records.tokenHash(record.requestId),
    )
    if (!check.valid) {
      await this.fail(record.requestId, check.reason)
      await deviceCall(this.env, deviceBrokerName(record.sender.id), {
        type: 'broker.cancel',
        requestId: record.requestId,
        workspaceId: record.workspaceId,
      })
      return
    }
    if (!record.device) {
      await this.fail(record.requestId, 'device_unavailable')
      return
    }
    const status = deviceObject(
      await deviceCall(this.env, deviceBrokerName(record.sender.id), {
        type: 'broker.check',
        device: record.device,
        requestId: record.requestId,
        workspaceId: record.workspaceId,
      }),
    )
    if (status.live !== true)
      await this.fail(record.requestId, 'device_unavailable')
    else if (status.known !== true) {
      if (
        record.state === 'waiting' &&
        !(await this.records.dispatched(record.requestId))
      ) {
        const sent =
          deviceObject(
            await deviceCall(this.env, deviceBrokerName(record.sender.id), {
              type: 'broker.dispatch',
              request: record,
              tokenHash: await this.records.tokenHash(record.requestId),
            }),
          ).sent === true
        if (sent) return
      }
      await this.fail(record.requestId, 'device_unavailable')
    }
  }
  async reconcile(): Promise<void> {
    await this.records.run(() => this.records.flush())
    for (const record of await this.records.list())
      if (commandPending(record)) await this.refresh(record)
  }
  async operation(
    operation: Record<string, unknown>,
  ): Promise<DeviceOperationValue> {
    const record = await this.records.require(
      deviceRequired(operation.requestId),
    )
    if (!this.matches(record.workspaceId))
      throw new HttpError(
        403,
        'device_forbidden',
        'The Mac request is not available.',
      )
    if (operation.type === 'workspace.validate')
      return commandPending(record)
        ? await this.validation(record, deviceRequired(operation.tokenHash))
        : { valid: false, reason: 'request_ended' }
    if (
      operation.type !== 'workspace.update' &&
      operation.type !== 'workspace.claim'
    )
      throw new HttpError(404, 'not_found', 'The page is not available.')
    const device = readDevicePairing(operation.device)
    if (
      device.connectionId !== record.device?.connectionId ||
      device.deviceId !== record.device.deviceId ||
      deviceRequired(operation.desktopSessionId) !==
        (await this.records.desktopSession(record.requestId))
    )
      throw new HttpError(
        403,
        'device_forbidden',
        'The Mac request is not available.',
      )
    if (operation.type === 'workspace.claim') {
      const access = await this.validation(
        record,
        deviceRequired(operation.tokenHash),
      )
      const alive = await desktopSessionAlive(
        this.env.DB,
        deviceRequired(operation.desktopSessionId),
        record.sender.id,
        this.now(),
      )
      return {
        claimed:
          access.valid &&
          Boolean(alive) &&
          (await this.records.markDispatched(record.requestId)),
      }
    }
    const state = readDeviceState(operation.state)
    const updated = await this.records.change(
      record.requestId,
      async (current) => {
        if (!commandPending(current)) return current
        if (state === 'unavailable')
          return {
            ...current,
            state,
            error: {
              code: 'device_unavailable',
              message: 'The Mac is not available.',
            },
            updatedAt: this.now(),
          }
        const check = await this.validation(
          current,
          await this.records.tokenHash(current.requestId),
        )
        const alive = await desktopSessionAlive(
          this.env.DB,
          deviceRequired(operation.desktopSessionId),
          current.sender.id,
          this.now(),
        )
        if (!check.valid || !alive)
          return {
            ...current,
            state: check.reason === 'turn_ended' ? 'failed' : 'unavailable',
            updatedAt: this.now(),
            error: {
              code: check.valid ? 'device_unavailable' : check.reason,
              message:
                check.reason === 'turn_ended'
                  ? 'The agent turn has ended.'
                  : 'The Mac is not available.',
            },
          }
        if (
          state === 'waiting' ||
          (state === 'running' && current.state !== 'waiting') ||
          (['completed', 'timed-out'].includes(state) &&
            current.state !== 'running')
        )
          return current
        const error =
          operation.error === undefined ? null : deviceObject(operation.error)
        return {
          ...current,
          state,
          startedAt:
            state === 'running'
              ? (current.startedAt ?? this.now())
              : current.startedAt,
          result:
            operation.result === undefined
              ? null
              : readDeviceResult(operation.result),
          error: error
            ? {
                code: deviceRequired(error.code),
                message: deviceRequired(error.message),
              }
            : null,
          updatedAt: this.now(),
        }
      },
    )
    return { request: updated }
  }
}
