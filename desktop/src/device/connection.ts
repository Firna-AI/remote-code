import type { DevicePairing } from '../../../src/shared/generated/DevicePairing.js'
import {
  DEVICE_HEARTBEAT_MS,
  DEVICE_LEASE_MS,
} from '../../../src/shared/device.ts'
import type { DeviceToWorker } from '../../../src/shared/device.ts'
import type { DeviceClock } from './clock.js'
import type { DeviceSession } from './session.js'
import type { DeviceSocket, SocketEvents } from './transport.js'

export interface DeviceCredential {
  value: string
  expiresAt: number
}
export interface DeviceAccount {
  userId: string
  appAccess: boolean
}
interface ConnectionDependencies {
  deviceId: string
  clock: DeviceClock
  readCredential(): Promise<DeviceCredential | undefined>
  authenticate(
    value: string,
    signal: AbortSignal,
  ): Promise<DeviceAccount | undefined>
  connect(value: string, events: SocketEvents): DeviceSocket
  session(
    userId: string,
    pairing: DevicePairing,
    send: (message: DeviceToWorker) => boolean,
    invalid: () => void,
  ): DeviceSession
  /** The sign-in of the app is gone, expired, or rejected. */
  signedOut(): void
  warn(): void
}

/** Cookie changes invalidate the old socket synchronously, before any read. */
export function createDeviceConnection(dependencies: ConnectionDependencies) {
  let awake = true
  let stopped = false
  let generation = 0
  let socket: DeviceSocket | undefined
  let session: DeviceSession | undefined
  let abort: AbortController | undefined
  let cancelBeat: (() => void) | undefined
  let cancelExpiry: (() => void) | undefined
  let cancelRetry: (() => void) | undefined
  let retryMs = 1000
  const clear = () => {
    generation++
    cancelBeat?.()
    cancelExpiry?.()
    cancelRetry?.()
    cancelBeat = cancelExpiry = cancelRetry = undefined
    abort?.abort()
    abort = undefined
    session?.dispose()
    session = undefined
    const previous = socket
    socket = undefined
    previous?.close()
  }
  const retry = () => {
    if (!awake || stopped) return
    cancelRetry = dependencies.clock.after(retryMs, () => {
      void refresh()
    })
    retryMs = Math.min(retryMs * 2, DEVICE_LEASE_MS)
  }
  const refresh = async () => {
    clear()
    if (!awake || stopped) return
    const current = generation
    const live = () => current === generation && awake && !stopped
    const ended = (rejected = false) => {
      if (!live()) return
      clear()
      if (!rejected) retry()
    }
    try {
      const credential = await dependencies.readCredential()
      if (!live()) return
      if (!credential || credential.expiresAt <= dependencies.clock.now()) {
        dependencies.signedOut()
        return
      }
      cancelExpiry = dependencies.clock.after(
        credential.expiresAt - dependencies.clock.now(),
        () => {
          if (!live()) return
          clear()
          dependencies.signedOut()
        },
      )
      const authentication = new AbortController()
      abort = authentication
      cancelBeat = dependencies.clock.after(DEVICE_LEASE_MS, () => ended())
      const account = await dependencies.authenticate(
        credential.value,
        authentication.signal,
      )
      if (!live()) return
      cancelBeat?.()
      if (!account) {
        dependencies.signedOut()
        ended(true)
        return
      }
      if (!account.appAccess) {
        ended()
        return
      }
      let lastPong = dependencies.clock.now()
      const send = (message: DeviceToWorker) => {
        if (!live() || !socket) return false
        const sent = socket.send(message)
        if (!sent) ended()
        return sent
      }
      socket = dependencies.connect(credential.value, {
        closed: ended,
        message(message) {
          if (!live()) return
          if (message.type === 'device.connected') {
            if (session || message.device.deviceId !== dependencies.deviceId) {
              ended(true)
              return
            }
            lastPong = dependencies.clock.now()
            retryMs = 1000
            session = dependencies.session(
              account.userId,
              message.device,
              send,
              () => ended(true),
            )
          } else if (message.type === 'device.pong') {
            if (session) lastPong = dependencies.clock.now()
          } else {
            if (!session) {
              ended(true)
              return
            }
            session.receive(message)
          }
        },
      })
      const beat = () => {
        if (!live()) return
        if (dependencies.clock.now() - lastPong >= DEVICE_LEASE_MS) {
          ended()
          return
        }
        if (session && !send({ type: 'device.ping' })) return
        cancelBeat = dependencies.clock.after(DEVICE_HEARTBEAT_MS, beat)
      }
      cancelBeat = dependencies.clock.after(DEVICE_HEARTBEAT_MS, beat)
    } catch {
      if (!live()) return
      dependencies.warn()
      ended()
    }
  }
  return {
    start: refresh,
    cookieChanged: refresh,
    sleep(): void {
      awake = false
      socket?.send({ type: 'device.sleep' })
      clear()
    },
    wake(): Promise<void> {
      awake = true
      return refresh()
    },
    stop(): void {
      stopped = true
      clear()
    },
  }
}
