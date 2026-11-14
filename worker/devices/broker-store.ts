import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord'

import {
  deviceObject,
  deviceRequired,
  deviceNumber,
  readDeviceRecord,
} from '../../src/shared/device-read'
import type { ChatStorage } from '../chat/types'
import { hash } from '../security/crypto'
import type { BrokerRequest } from './broker-types'
import { deleteDeviceValue, readDeviceValue, writeDeviceValue } from './storage'

const PENDING = 'devices:v1:broker-request:'
export class BrokerRequests {
  private readonly storage: ChatStorage
  constructor(storage: ChatStorage) {
    this.storage = storage
  }
  async pending(): Promise<BrokerRequest[]> {
    return Promise.all(
      [...(await this.storage.list({ prefix: PENDING })).keys()].map(
        async (key) => {
          const value = deviceObject(await readDeviceValue(this.storage, key))
          return {
            request: readDeviceRecord(value.request),
            tokenHash: deviceRequired(value.tokenHash),
            sessionId: deviceRequired(value.sessionId),
            executionDeadline:
              value.executionDeadline === null
                ? null
                : deviceNumber(value.executionDeadline),
          }
        },
      ),
    )
  }
  private async key(request: DeviceCommandRecord) {
    return (
      PENDING +
      (await hash(JSON.stringify([request.workspaceId, request.requestId])))
    )
  }
  async store(item: BrokerRequest): Promise<void> {
    const key = await this.key(item.request)
    await this.storage.transaction((data) => writeDeviceValue(data, key, item))
  }
  async forget(item: BrokerRequest): Promise<void> {
    const key = await this.key(item.request)
    await this.storage.transaction((data) => deleteDeviceValue(data, key))
  }
  async has(request: DeviceCommandRecord): Promise<boolean> {
    return (await this.storage.get(await this.key(request))) !== undefined
  }
}
