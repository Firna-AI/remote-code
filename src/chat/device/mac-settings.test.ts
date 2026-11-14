import type { DevicePairing } from '../../shared/generated/DevicePairing'
import { describe, expect, it, vi } from 'vitest'
import { createApiClient, type FetchLike } from '../../app/api/client'
import {
  DEVICE_CURRENT_PATH,
  type DeviceSettings,
  type DeviceSettingsOutcome,
} from '../../shared/device'
import { deviceObject, deviceText } from '../../shared/device-read'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import {
  FAKE_PAIRING,
  fakeMacSettings,
} from '../../test-support/fixtures/devices'
import { createDeviceApi } from './device-api'
import { MacSettingsController } from './mac-settings'
import { controlOf } from './settings-results'

/**
 * A Mac behind a gate: each request waits until the test lets the oldest
 * one go, and the Mac acts on the requests in the order that they reach it.
 * `outcomes` gives the outcome of each change in turn, and done after them.
 * A Remove that the Mac makes takes the command away; a Stop takes the 15
 * minutes away. The Mac can go away, and come back under a new pairing.
 */
function gatedMac(outcomes: DeviceSettingsOutcome[] = []) {
  let settings: DeviceSettings = fakeMacSettings()
  let pairing: DevicePairing | null = FAKE_PAIRING
  let open = true
  const waiting: (() => void)[] = []
  const handled: string[] = []
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(
      new URL(String(input), 'https://app.test'),
      init,
    )
    if (!open) await new Promise<void>((resolve) => waiting.push(resolve))
    const path = new URL(request.url).pathname
    if (path === DEVICE_CURRENT_PATH) {
      handled.push('read pairing')
      return Response.json({ device: pairing })
    }
    let outcome: DeviceSettingsOutcome = { status: 'done' }
    if (request.method === 'POST') {
      const operation = deviceObject(
        deviceObject(await request.json()).operation,
      )
      outcome = outcomes.shift() ?? { status: 'done' }
      const subject =
        operation.action === 'remove-command'
          ? deviceText(operation.command)
          : deviceText(operation.workspaceId)
      handled.push(`${String(operation.action)} ${subject}`)
      if (outcome.status !== 'failed') {
        settings = {
          ...settings,
          alwaysAllowedCommands: settings.alwaysAllowedCommands.filter(
            (item) => item !== subject,
          ),
          workspaceWindows: settings.workspaceWindows.filter(
            (item) => item.workspaceId !== subject,
          ),
        }
      }
    } else {
      handled.push('read settings')
    }
    return Response.json({ ...pairing, settings, outcome })
  }
  return {
    fetch,
    handled,
    waiting,
    hold: () => {
      open = false
    },
    /** Lets every request that waits, and each later one, go. */
    free: () => {
      open = true
      for (const go of waiting.splice(0)) go()
    },
    pair: (next: DevicePairing | null) => {
      pairing = next
    },
  }
}

const removeLint = {
  action: 'remove-command',
  command: 'npm run lint',
} as const
const stop = {
  action: 'stop-workspace',
  workspaceId: FAKE_IDS.workspace,
} as const
const failed = {
  status: 'failed',
  message: 'The Mac could not change this permission. Try again.',
} as const
const lintControl = controlOf(removeLint)
const stopControl = controlOf(stop)

describe('MacSettingsController', () => {
  it('records which change waits on a control that Stop and Keep share', async () => {
    const mac = gatedMac()
    const controller = new MacSettingsController(
      createDeviceApi(createApiClient(mac.fetch)),
    )
    await controller.start()
    mac.hold()
    const keep = {
      action: 'keep-workspace',
      workspaceId: FAKE_IDS.workspace,
    } as const
    expect(controlOf(keep)).toBe(stopControl)
    const kept = controller.change(keep)
    expect(controller.get()).toMatchObject({
      busy: [stopControl],
      waiting: { [stopControl]: 'keep-workspace' },
    })
    mac.free()
    await kept
    expect(controller.get()).toMatchObject({ busy: [], waiting: {} })
  })

  it('sends one read or change at a time, so the reply of the last one holds every change', async () => {
    const mac = gatedMac()
    const controller = new MacSettingsController(
      createDeviceApi(createApiClient(mac.fetch)),
    )
    await controller.start()
    mac.hold()
    const work = Promise.all([
      controller.refresh(),
      controller.change({ action: 'remove-command', command: 'git status' }),
      controller.change({ action: 'remove-command', command: 'sw_vers' }),
    ])
    for (let step = 0; step < 4; step += 1) {
      await vi.waitFor(() => expect(mac.waiting).toHaveLength(1))
      mac.waiting.shift()?.()
    }
    await work
    expect(mac.handled.slice(2)).toEqual([
      'read pairing',
      'read settings',
      'remove-command git status',
      'remove-command sw_vers',
    ])
    expect(controller.get()).toMatchObject({
      kind: 'ready',
      busy: [],
      settings: {
        alwaysAllowedCommands: fakeMacSettings().alwaysAllowedCommands.filter(
          (command) => command !== 'git status' && command !== 'sw_vers',
        ),
      },
    })
  })

  it('keeps the failure of a control through a read, a Mac that goes away, and a new pairing, until the next change of that control', async () => {
    const mac = gatedMac([failed])
    const controller = new MacSettingsController(
      createDeviceApi(createApiClient(mac.fetch)),
    )
    await controller.start()
    await controller.change(removeLint)
    const kept = {
      [lintControl]: {
        change: removeLint,
        subject: 'npm run lint',
        outcome: failed,
      },
    }
    expect(controller.get().results).toEqual(kept)

    await controller.refresh()
    mac.pair(null)
    await controller.load()
    expect(controller.get()).toMatchObject({ kind: 'unavailable' })
    expect(controller.get().results).toEqual(kept)
    const next = { ...FAKE_PAIRING, connectionId: 'connection-2' }
    mac.pair(next)
    await controller.load()
    await controller.change({ action: 'remove-command', command: 'sw_vers' })
    expect(controller.get()).toMatchObject({ kind: 'ready', pairing: next })
    expect(controller.get().results).toMatchObject(kept)

    await controller.change(removeLint)
    expect(controller.get().results[lintControl]).toEqual({
      change: removeLint,
      subject: 'npm run lint',
      outcome: { status: 'done' },
    })
  })

  it('never sends a Stop that waited while the Mac reconnected, and keeps its failure until the user stops again', async () => {
    const mac = gatedMac()
    const controller = new MacSettingsController(
      createDeviceApi(createApiClient(mac.fetch)),
    )
    await controller.start()
    mac.hold()
    const next = { ...FAKE_PAIRING, connectionId: 'connection-2' }
    mac.pair(next)
    const read = controller.refresh()
    const stopped = controller.change(stop)
    expect(controller.get().busy).toEqual([stopControl])
    for (let step = 0; step < 2; step += 1) {
      await vi.waitFor(() => expect(mac.waiting).toHaveLength(1))
      mac.waiting.shift()?.()
    }
    mac.free()
    await Promise.all([read, stopped])
    expect(mac.handled.slice(2)).toEqual(['read pairing', 'read settings'])
    expect(controller.get()).toMatchObject({
      kind: 'ready',
      pairing: next,
      busy: [],
      settings: { workspaceWindows: [{ workspaceId: FAKE_IDS.workspace }] },
      results: {
        [stopControl]: {
          change: stop,
          subject: 'Checkout address autocomplete',
          outcome: {
            status: 'failed',
            message:
              'This Mac reconnected before the change reached it. Try again.',
          },
        },
      },
    })

    await controller.change(stop)
    expect(mac.handled.at(-1)).toBe(`stop-workspace ${FAKE_IDS.workspace}`)
    expect(controller.get()).toMatchObject({
      settings: { workspaceWindows: [] },
      results: { [stopControl]: { outcome: { status: 'done' } } },
    })
  })
})
