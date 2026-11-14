import type { DeviceCommandRecord } from '../../shared/generated/DeviceCommandRecord'
import type { DevicePairing } from '../../shared/generated/DevicePairing'
import { safariOutput } from '../../../docs/mockups/src/fixtures/mac'
import {
  DEVICE_CURRENT_PATH,
  DEVICE_SETTINGS_PATH,
  deviceApprovalPath,
  deviceCommandsPath,
  type DeviceApprovalAction,
  type DeviceSettings,
  type DeviceSettingsOutcome,
} from '../../shared/device'
import {
  FAKE_PAIRING,
  fakeLiteralCommands,
  fakeMacRequests,
  fakeMacSettings,
  type FakeMacScenario,
} from '../../test-support/fixtures/devices'
import { oneOf, record } from '../api/json'
import type { DevBackend } from './dev-backend'
import { changeMacSettings } from './dev-mac-settings'

const readAction = oneOf<DeviceApprovalAction>({
  deny: true,
  allow: true,
  'always-allow': true,
  'allow-workspace-15-minutes': true,
  'allow-workspace-until-stop': true,
})

/**
 * The requests and the settings of the development page's Mac. While a
 * request waits, no 15 minutes run, because they would answer it. A
 * listener hears each change, as the Mac app's banner does.
 */
export class DevMac {
  readonly onMac: boolean
  /** The outcome of each change of the settings, from the `change` option. */
  readonly outcome: DeviceSettingsOutcome['status']
  requests: DeviceCommandRecord[]
  settings: DeviceSettings
  /** The pairing of the window with the current connection of the Mac. */
  pairing: DevicePairing = FAKE_PAIRING
  private readonly listeners = new Set<() => void>()

  constructor(
    scenario: FakeMacScenario,
    now: number,
    onMac: boolean,
    outcome: DeviceSettingsOutcome['status'],
  ) {
    this.onMac = onMac
    this.outcome = outcome
    this.requests = [...fakeMacRequests(scenario)]
    const base = fakeMacSettings(now)
    const settings =
      scenario === 'literal'
        ? {
            ...base,
            alwaysAllowedCommands: [
              ...base.alwaysAllowedCommands,
              ...fakeLiteralCommands,
            ],
          }
        : base
    const waits = this.requests.some((request) => request.state === 'waiting')
    this.settings = waits ? { ...settings, workspaceWindows: [] } : settings
  }

  listen(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  changed(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * The Mac connects again, as after sleep, under a new connection. The
   * window learns the new pairing at its next read, and the Worker refuses
   * a change that names the old one.
   */
  reconnect(): void {
    const count = Number(this.pairing.connectionId.split('-').at(-1)) + 1
    this.pairing = { ...this.pairing, connectionId: `connection-${count}` }
  }
}

/** Writes the replies of the Mac's records. A browser keeps its refusal of settings. */
export function writeMacReplies(backend: DevBackend): void {
  const { mac, target } = backend
  backend.server.json(
    'GET',
    deviceCommandsPath(target.orgId, target.workspaceId),
    { requests: mac.requests },
  )
  if (!mac.onMac) return
  backend.server.json('GET', DEVICE_CURRENT_PATH, { device: mac.pairing })
  backend.server.json('GET', DEVICE_SETTINGS_PATH, {
    ...mac.pairing,
    settings: mac.settings,
    outcome: { status: 'done' },
  })
}

/** Writes the replies, and tells the chat and the banner, as the Worker does. */
function publish(backend: DevBackend): void {
  writeMacReplies(backend)
  const waits = backend.mac.requests.some(
    (request) => request.state === 'waiting',
  )
  if (backend.workspace.state === 'input' && !waits) {
    backend.workspace = { ...backend.workspace, state: 'working' }
  }
  backend.stream.emit({
    type: 'workspace.updated',
    workspace: backend.workspace,
  })
  backend.mac.changed()
}

/**
 * The Mac connects again under a new connection, and the page reads it
 * again. A change that the user made before that read names the old
 * connection.
 */
export function reconnectMac(backend: DevBackend): void {
  backend.mac.reconnect()
  publish(backend)
}

function update(
  backend: DevBackend,
  requestId: string,
  change: Partial<DeviceCommandRecord>,
): void {
  const updatedAt = backend.clock.now()
  backend.mac.requests = backend.mac.requests.map((request) =>
    request.requestId === requestId
      ? { ...request, ...change, updatedAt }
      : request,
  )
  publish(backend)
}

function later(backend: DevBackend, delayMs: number, run: () => void): void {
  backend.timers.push(window.setTimeout(run, delayMs))
}

/** Acts on an answer as the Mac app does, and keeps a saved choice. */
function answer(
  backend: DevBackend,
  request: DeviceCommandRecord,
  action: DeviceApprovalAction,
): void {
  const { mac } = backend
  if (action === 'deny')
    return update(backend, request.requestId, { state: 'denied' })
  const commands = mac.settings.alwaysAllowedCommands
  if (action === 'always-allow' && !commands.includes(request.command)) {
    mac.settings = {
      ...mac.settings,
      alwaysAllowedCommands: [...commands, request.command],
    }
  }
  if (
    action === 'allow-workspace-15-minutes' ||
    action === 'allow-workspace-until-stop'
  ) {
    const others = mac.settings.workspaceWindows.filter(
      (grant) => grant.workspaceId !== request.workspaceId,
    )
    const current = mac.settings.workspaceWindows.find(
      (grant) => grant.workspaceId === request.workspaceId,
    )
    // As on the Mac, the 15 minutes never shorten a grant until Stop.
    const keeps =
      action === 'allow-workspace-15-minutes' &&
      current !== undefined &&
      (current.expiresAt === null || current.expiresAt > backend.clock.now())
    const expiresAt =
      action === 'allow-workspace-until-stop'
        ? null
        : backend.clock.now() + 15 * 60_000
    if (!keeps)
      mac.settings = {
        ...mac.settings,
        workspaceWindows: [
          ...others,
          {
            workspaceId: request.workspaceId,
            workspaceName: request.workspaceName,
            expiresAt,
          },
        ],
      }
  }
  update(backend, request.requestId, {
    state: 'running',
    startedAt: backend.clock.now(),
  })
  later(backend, 1_600, () =>
    update(backend, request.requestId, {
      state: 'completed',
      result: {
        stdout: safariOutput,
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncated: false,
      },
    }),
  )
}

/**
 * Answers the writes of Mac commands: an answer, which the Mac acts on a
 * moment later, and a change of the Mac's settings. Other writes go on.
 */
export async function handleMacWrite(
  backend: DevBackend,
  request: Request,
): Promise<Response | null> {
  if (request.method !== 'POST') return null
  const path = new URL(request.url).pathname
  const { orgId, workspaceId } = backend.target
  const body = (): Promise<Record<string, unknown>> =>
    request
      .clone()
      .json()
      .then((value: unknown) => record(value))
  if (path === DEVICE_SETTINGS_PATH)
    return changeMacSettings(backend.mac, await body(), () => publish(backend))
  const target = backend.mac.requests.find(
    (item) => path === deviceApprovalPath(orgId, workspaceId, item.requestKey),
  )
  if (!target || target.state !== 'waiting') return null
  const action = readAction((await body()).action)
  later(backend, 700, () => answer(backend, target, action))
  return Response.json({ accepted: true }, { status: 202 })
}
