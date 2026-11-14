import type { DeviceCommandRecord } from '../../../src/shared/generated/DeviceCommandRecord.js'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { app, Notification, powerMonitor } from 'electron'
import type { Cookie, Session } from 'electron'

import { DESKTOP_SESSION_COOKIE } from '../../../worker/security/desktop-contract.js'
import { deviceClock } from './clock.js'
import { createDeviceConnection } from './connection.js'
import { desktopCredential, deviceAccount } from './credentials.js'
import { privateDeviceFiles, stableDeviceId } from './files.js'
import { notifyCommand } from './notification.js'
import { localCommandLauncher } from './process.js'
import { createDeviceSessionFactory } from './session-factory.js'
import { connectDevice } from './transport.js'

interface MainDeviceDependencies {
  appOrigin: string
  userData: string
  rendererSession: Session
  foreground(): boolean
  openWorkspace(request: DeviceCommandRecord): void
  warn(): void
}

/** All OS access stays in main. Approval and settings use the Worker relay. */
export function startMacDevice(dependencies: MainDeviceDependencies): void {
  try {
    const { appOrigin, rendererSession, warn } = dependencies
    const files = privateDeviceFiles(resolve(dependencies.userData, 'device'))
    const deviceId = stableDeviceId(files)
    const sessions = createDeviceSessionFactory({
      files,
      deviceName: hostname(),
      clock: deviceClock,
      launch: localCommandLauncher(),
      warn,
      notify: (request) =>
        notifyCommand(request, {
          foreground: dependencies.foreground,
          create: (options) =>
            Notification.isSupported() ? new Notification(options) : undefined,
          open: dependencies.openWorkspace,
          warn,
        }),
    })
    const connection = createDeviceConnection({
      deviceId,
      clock: deviceClock,
      readCredential: async () =>
        desktopCredential(
          await rendererSession.cookies.get({
            url: appOrigin,
            name: DESKTOP_SESSION_COOKIE,
          }),
          appOrigin,
          deviceClock.now(),
        ),
      authenticate: (credential, signal) =>
        deviceAccount(appOrigin, credential, signal),
      connect: (credential, events) =>
        connectDevice({
          appOrigin,
          deviceId,
          deviceName: hostname(),
          credential,
          events,
        }),
      session: sessions.session,
      signedOut: sessions.signedOut,
      warn,
    })
    const changed = (_event: unknown, cookie: Cookie) => {
      if (
        cookie.name === DESKTOP_SESSION_COOKIE &&
        cookie.domain === new URL(appOrigin).hostname
      )
        void connection.cookieChanged()
    }
    const wake = () => {
      void connection.wake()
    }
    rendererSession.cookies.on('changed', changed)
    powerMonitor.on('suspend', connection.sleep)
    powerMonitor.on('resume', wake)
    app.once('before-quit', () => {
      rendererSession.cookies.removeListener('changed', changed)
      powerMonitor.removeListener('suspend', connection.sleep)
      powerMonitor.removeListener('resume', wake)
      connection.stop()
      sessions.dispose()
    })
    void connection.start()
  } catch {
    dependencies.warn()
  }
}
