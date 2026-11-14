import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord'
import { readDeviceRecord } from '../../src/shared/device-read'

import type { ChatData } from '../chat/types'
import { readDeviceValue } from './storage'

export const DEVICE_RECORDS_PREFIX = 'devices:v1:request:'

export async function readDeviceCommands(
  data: ChatData,
): Promise<DeviceCommandRecord[]> {
  const records = await Promise.all(
    [...(await data.list({ prefix: DEVICE_RECORDS_PREFIX })).keys()].map(
      async (key) => readDeviceRecord(await readDeviceValue(data, key)),
    ),
  )
  return records.sort(
    (a, b) =>
      a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId),
  )
}
