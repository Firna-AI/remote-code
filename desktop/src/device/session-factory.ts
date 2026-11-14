import type { DeviceCommandRecord } from '../../../src/shared/generated/DeviceCommandRecord.js'
import type { DevicePairing } from '../../../src/shared/generated/DevicePairing.js'
import type { DeviceToWorker } from '../../../src/shared/device.ts'
import type { DeviceClock } from './clock.js'
import type { DeviceFiles } from './files.js'
import { createPermissionStore } from './permissions.js'
import type { PermissionStore } from './permissions.js'
import type { LaunchCommand } from './process.js'
import { runCommand } from './runner.js'
import { createDeviceSession } from './session.js'

interface SessionFactoryDependencies {
  files: DeviceFiles
  deviceName: string
  clock: DeviceClock
  launch: LaunchCommand
  notify(request: DeviceCommandRecord): () => void
  warn(): void
}

/**
 * The application owns account permissions across all device connections.
 * A grant until Stop belongs to one signed-in account: a sign-out, or a
 * session of another account, ends it.
 */
export function createDeviceSessionFactory(
  dependencies: SessionFactoryDependencies,
) {
  const stores = new Map<string, PermissionStore>()
  return {
    /** The account of this app signed out, or its sign-in ended. */
    signedOut(): void {
      stores.forEach((store) => store.endUntilStop())
    },
    session(
      userId: string,
      pairing: DevicePairing,
      send: (message: DeviceToWorker) => boolean,
      invalid: () => void,
    ) {
      stores.forEach((store, owner) => {
        if (owner !== userId) store.endUntilStop()
      })
      let permissions = stores.get(userId)
      if (permissions) permissions.retryRead()
      else {
        permissions = createPermissionStore({ ...dependencies, userId })
        stores.set(userId, permissions)
      }
      return createDeviceSession({
        ...dependencies,
        userId,
        pairing,
        send,
        invalid,
        permissions,
        run: (request) => runCommand(request, dependencies),
      })
    },
    dispose(): void {
      stores.forEach((store) => store.dispose())
      stores.clear()
    },
  }
}
