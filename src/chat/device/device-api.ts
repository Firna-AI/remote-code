import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import type { DevicePairing } from '../../shared/generated/DevicePairing'
import type { ApiClient } from '../../app/api/client'
import {
  DEVICE_CURRENT_PATH,
  DEVICE_SETTINGS_PATH,
  deviceApprovalPath,
  deviceCommandsPath,
  type DeviceApprovalAction,
  type DeviceApprovalRequest,
  type DeviceSettingsRequest,
} from '../../shared/device'
import {
  readDevicePairing,
  readDeviceRecord,
  readDeviceSettingsResponse,
} from '../../shared/device-read'
import type { WorkspaceTarget } from '../api/client'
import {
  list,
  nullable,
  record,
  UnreadableResponse,
  type Reader,
} from '../api/json'

/** A change that the Mac makes to its own settings. */
export type SettingsChange = DeviceSettingsRequest['operation']

const readDeviceCommands: Reader<readonly DeviceCommandRecord[]> = (value) =>
  list(readDeviceRecord)(record(value).requests)

const readDeviceCurrent: Reader<DevicePairing | null> = (value) =>
  nullable(readDevicePairing)(record(value).device)

/** The Worker took the answer, to pass it to the Mac. It is not the result. */
const readAccepted: Reader<true> = (value) => {
  if (record(value).accepted !== true) throw new UnreadableResponse('accepted')
  return true
}

/** Only the two IDs of a pairing go into a body. */
function pairingOf(pairing: DevicePairing): DevicePairing {
  return { deviceId: pairing.deviceId, connectionId: pairing.connectionId }
}

/**
 * The routes of Mac commands. The IDs of a pairing name a connection, and
 * give no access: the Worker checks the session of the window itself.
 */
export function createDeviceApi(client: ApiClient) {
  return {
    commands: (target: WorkspaceTarget) =>
      client.get(
        deviceCommandsPath(target.orgId, target.workspaceId),
        readDeviceCommands,
      ),
    current: () => client.get(DEVICE_CURRENT_PATH, readDeviceCurrent),
    /** The address names the request by its key, which the Worker gives. */
    answer: (
      target: WorkspaceTarget,
      requestKey: string,
      pairing: DevicePairing,
      action: DeviceApprovalAction,
    ) =>
      client.send(
        'POST',
        deviceApprovalPath(target.orgId, target.workspaceId, requestKey),
        { ...pairingOf(pairing), action } satisfies DeviceApprovalRequest,
        readAccepted,
      ),
    settings: () =>
      client.get(DEVICE_SETTINGS_PATH, readDeviceSettingsResponse),
    changeSettings: (pairing: DevicePairing, operation: SettingsChange) =>
      client.send(
        'POST',
        DEVICE_SETTINGS_PATH,
        {
          ...pairingOf(pairing),
          operation,
        } satisfies DeviceSettingsRequest,
        readDeviceSettingsResponse,
      ),
  }
}

export type DeviceApi = ReturnType<typeof createDeviceApi>
