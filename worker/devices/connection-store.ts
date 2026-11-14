import type { DevicePairing } from '../../src/shared/generated/DevicePairing'
import {
  deviceNumber,
  deviceObject,
  deviceRequired,
  readDevicePairing,
} from '../../src/shared/device-read'

import type { ChatStorage } from '../chat/types'
import { readDeviceValue, writeDeviceValue } from './storage'

const KEY = 'native:device:current'

export interface StoredDeviceConnection {
  generation: number
  device: DevicePairing
  deviceName: string | null
  userId: string
  sessionId: string
  lastSeen: number
  nextCheckAt: number
}

export class DeviceConnectionStore {
  private readonly storage: ChatStorage
  constructor(storage: ChatStorage) {
    this.storage = storage
  }

  async read(): Promise<StoredDeviceConnection | null> {
    const stored = await readDeviceValue(this.storage, KEY)
    if (stored === undefined) return null
    const value = deviceObject(stored)
    if (value.connection === null) return null
    const connection = deviceObject(value.connection)
    return {
      generation: deviceNumber(value.generation),
      device: readDevicePairing(connection.device),
      deviceName:
        typeof connection.deviceName === 'string'
          ? connection.deviceName
          : null,
      userId: deviceRequired(connection.userId),
      sessionId: deviceRequired(connection.sessionId),
      lastSeen: deviceNumber(connection.lastSeen),
      nextCheckAt: deviceNumber(connection.nextCheckAt),
    }
  }

  async replace(
    connection: Omit<StoredDeviceConnection, 'generation'>,
  ): Promise<StoredDeviceConnection> {
    return this.storage.transaction(async (storage) => {
      const previous = await readDeviceValue(storage, KEY)
      const generation =
        previous === undefined
          ? 1
          : deviceNumber(deviceObject(previous).generation) + 1
      const record = { ...connection, generation }
      await writeDeviceValue(storage, KEY, { generation, connection: record })
      return record
    })
  }

  async save(
    record: StoredDeviceConnection | null,
    generation: number,
  ): Promise<void> {
    await this.storage.transaction(async (storage) => {
      const stored = await readDeviceValue(storage, KEY)
      if (
        stored === undefined ||
        deviceObject(stored).generation !== generation ||
        (record !== null && deviceObject(stored).connection === null)
      )
        return
      await writeDeviceValue(storage, KEY, { generation, connection: record })
    })
  }
}
