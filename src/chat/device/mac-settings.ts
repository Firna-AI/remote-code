import type { DevicePairing } from '../../shared/generated/DevicePairing'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ApiError, type ApiClient } from '../../app/api/client'
import type {
  DeviceSettings,
  DeviceSettingsResponse,
} from '../../shared/device'
import { messageOf } from '../state/context'
import {
  createDeviceApi,
  type DeviceApi,
  type SettingsChange,
} from './device-api'
import {
  controlOf,
  staleCause,
  subjectOf,
  type ChangeResult,
} from './settings-results'

/** The settings of this Mac, as the last read or change gave them. */
export type MacSettingsView =
  | { kind: 'loading' }
  /** This window has no live connection to its Mac. */
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; pairing: DevicePairing; settings: DeviceSettings }

/**
 * The settings of this Mac, as the section shows them, with the changes
 * that wait and the result of the last change of each control. The results
 * stay through every read, a Mac that goes away, and a new pairing.
 */
export type MacSettingsState = MacSettingsView & {
  /** The controls whose change waits for the Mac: the keys of `waiting`. */
  busy: readonly string[]
  /** The action of the change that waits, by control. */
  waiting: Readonly<Record<string, SettingsChange['action']>>
  /** The result of the last change of each control, by control. */
  results: Readonly<Record<string, ChangeResult>>
}

const unavailable = (error: unknown) =>
  error instanceof ApiError && error.code === 'device_unavailable'

/** The settings and the pairing of a reply. */
function readyView(reply: DeviceSettingsResponse): MacSettingsView {
  const pairing = { deviceId: reply.deviceId, connectionId: reply.connectionId }
  return { kind: 'ready', pairing, settings: reply.settings }
}

/**
 * Reads and changes the settings of this Mac. The Mac keeps and applies
 * them, and the Worker only passes each read and change to it. One read or
 * change runs at a time, in the order of the user's actions, so the Mac
 * gets them in that order. Each reply holds the whole settings after its
 * operation, so the reply of the last operation shows the newest settings.
 * Each control keeps the result of its last change until its next change,
 * through every read and a new pairing. A change that fails reads the
 * settings again, because the Mac may still have made it. A change never
 * goes to a pairing other than the one that the user acted in: it fails
 * instead, and the user acts again.
 */
export class MacSettingsController {
  private readonly api: DeviceApi
  private readonly listeners = new Set<() => void>()
  private view: MacSettingsView = { kind: 'loading' }
  private waiting: Readonly<Record<string, SettingsChange['action']>> = {}
  private results: Readonly<Record<string, ChangeResult>> = {}
  private state: MacSettingsState = {
    ...this.view,
    busy: [],
    waiting: {},
    results: {},
  }
  private queue: Promise<void> = Promise.resolve()
  private alive = false

  constructor(api: DeviceApi) {
    this.api = api
  }

  readonly get = (): MacSettingsState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(): void {
    this.state = {
      ...this.view,
      busy: Object.keys(this.waiting),
      waiting: this.waiting,
      results: this.results,
    }
    for (const listener of this.listeners) listener()
  }

  private show(view: MacSettingsView): void {
    this.view = view
    this.publish()
  }

  /** Runs an operation after every operation before it has ended. */
  private enqueue(run: () => Promise<void>): Promise<void> {
    const next = this.queue.then(run)
    this.queue = next.catch(() => undefined)
    return next
  }

  readonly start = (): Promise<void> => {
    this.alive = true
    return this.load()
  }

  readonly stop = (): void => {
    this.alive = false
  }

  /** Reads the pairing of this window, then the settings of its Mac. */
  readonly load = (): Promise<void> => this.enqueue(() => this.read(false))

  /**
   * Reads again, such as after an answer that saved a choice. The settings
   * that show stay until the reply, and stay after a failed read.
   */
  readonly refresh = (): Promise<void> => this.enqueue(() => this.read(true))

  private async read(quiet: boolean): Promise<void> {
    if (!this.alive) return
    const keep = quiet && this.view.kind === 'ready'
    if (!keep) this.show({ kind: 'loading' })
    try {
      const pairing = await this.api.current()
      if (!this.alive) return
      if (!pairing) return this.show({ kind: 'unavailable' })
      const read = await this.api.settings()
      if (!this.alive) return
      this.show(readyView(read))
    } catch (error) {
      if (!this.alive) return
      if (unavailable(error)) this.show({ kind: 'unavailable' })
      else if (!keep) this.show({ kind: 'failed', message: messageOf(error) })
    }
  }

  /**
   * Asks the Mac to make one change. Its control is busy until the Mac
   * answers, and its result replaces the result of its last change.
   */
  readonly change = (change: SettingsChange): Promise<void> => {
    const view = this.view
    const key = controlOf(change)
    if (view.kind !== 'ready' || Object.hasOwn(this.waiting, key)) {
      return Promise.resolve()
    }
    const last = Object.hasOwn(this.results, key)
      ? this.results[key]
      : undefined
    const subject = subjectOf(change, view.settings, last)
    this.waiting = { ...this.waiting, [key]: change.action }
    this.results = Object.fromEntries(
      Object.entries(this.results).filter(([control]) => control !== key),
    )
    this.publish()
    return this.enqueue(() => this.send(key, view.pairing, change, subject))
  }

  private finish(key: string, result: ChangeResult): void {
    this.waiting = Object.fromEntries(
      Object.entries(this.waiting).filter(([control]) => control !== key),
    )
    this.results = { ...this.results, [key]: result }
    this.publish()
  }

  private async send(
    key: string,
    pairing: DevicePairing,
    change: SettingsChange,
    subject: string,
  ): Promise<void> {
    if (!this.alive) return
    const shown = this.view.kind === 'ready' ? this.view.pairing : null
    const stale = staleCause(shown, pairing)
    if (stale !== null) {
      return this.finish(key, {
        change,
        subject,
        outcome: { status: 'failed', message: stale },
      })
    }
    let reply: DeviceSettingsResponse
    try {
      reply = await this.api.changeSettings(pairing, change)
    } catch (error) {
      if (!this.alive) return
      this.finish(key, {
        change,
        subject,
        outcome: { status: 'failed', message: messageOf(error) },
      })
      void this.refresh()
      return
    }
    if (!this.alive) return
    this.view = readyView(reply)
    this.finish(key, { change, subject, outcome: reply.outcome })
  }
}

/**
 * The settings controller of this window, and its state. A new `client`
 * makes a new controller, so pass a stable one, such as the app's.
 */
export function useMacSettings(client: ApiClient): {
  controller: MacSettingsController
  state: MacSettingsState
} {
  const controller = useMemo(
    () => new MacSettingsController(createDeviceApi(client)),
    [client],
  )
  useEffect(() => {
    void controller.start()
    return controller.stop
  }, [controller])
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.get,
    controller.get,
  )
  return { controller, state }
}
