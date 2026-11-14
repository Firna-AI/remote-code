import type { DevicePairing } from '../../shared/generated/DevicePairing'
import type {
  DeviceSettings,
  DeviceSettingsOutcome,
  DeviceWorkspaceWindow,
} from '../../shared/device'
import type { SettingsChange } from './device-api'
import { equalPairing } from './device-snapshot'
import { nameLabel } from '../../shared/name-label'

/**
 * The end of one change of the Mac's settings: what the user asked for,
 * what it acts on, and what the Mac did. The Mac either made and saved the
 * change, made it but did not save it, or did not make it.
 */
export interface ChangeResult {
  change: SettingsChange
  /** The exact command, or the name of the workspace of the grant. */
  subject: string
  outcome: DeviceSettingsOutcome
}

/**
 * Whether a grant runs at `now`: the 15 minutes before their end, or a
 * grant until Stop, whose end time is null.
 */
export function grantRuns(grant: DeviceWorkspaceWindow, now: number): boolean {
  return grant.expiresAt === null || grant.expiresAt > now
}

/**
 * The control of a change: Remove of one exact command, or the grant of one
 * workspace, which Stop and Keep share. A control has one change at a
 * time, and keeps the result of its last change.
 */
export function controlOf(change: SettingsChange): string {
  return change.action === 'remove-command'
    ? `command:${change.command}`
    : `window:${change.workspaceId}`
}

/**
 * What a change acts on: the exact command, or the name of a workspace. A
 * Stop whose grant is gone keeps the name of its last result.
 */
export function subjectOf(
  change: SettingsChange,
  settings: DeviceSettings,
  last: ChangeResult | undefined,
): string {
  if (change.action === 'remove-command') return change.command
  const grant = settings.workspaceWindows.find(
    (window) => window.workspaceId === change.workspaceId,
  )
  return grant
    ? nameLabel(grant.workspaceName)
    : (last?.subject ?? change.workspaceId)
}

/**
 * Whether the control of a result is gone from the settings that show, so
 * that only the result can repeat its change. Null settings show nothing.
 */
function controlGone(
  result: ChangeResult,
  settings: DeviceSettings | null,
  now: number,
): boolean {
  if (settings === null) return true
  const { change } = result
  if (change.action === 'remove-command') {
    return !settings.alwaysAllowedCommands.includes(change.command)
  }
  return !settings.workspaceWindows.some(
    (grant) =>
      grant.workspaceId === change.workspaceId && grantRuns(grant, now),
  )
}

/**
 * Whether only the result can repeat its change: the Mac did not save or
 * did not make it, and its control is gone. A Keep is never repeated,
 * because it needs the 15 minutes that are gone.
 */
export function repeatable(
  result: ChangeResult,
  settings: DeviceSettings | null,
  now: number,
): boolean {
  return (
    result.outcome.status !== 'done' &&
    result.change.action !== 'keep-workspace' &&
    controlGone(result, settings, now)
  )
}

/** The name of the control that repeats the change of a result. */
export function repeatLabel(result: ChangeResult): string {
  return `Try again to ${verbs[result.change.action]} ${result.subject}`
}

const verbs = {
  'remove-command': 'remove',
  'stop-workspace': 'stop',
  'keep-workspace': 'keep',
  'extend-workspace': 'extend',
} as const satisfies Record<SettingsChange['action'], string>

/**
 * Why a change that waited no longer goes: this Mac went away, so no
 * pairing shows, or it reconnected, so the pairing that shows is not the
 * one that the user acted in. Null when the change can go.
 */
export function staleCause(
  shown: DevicePairing | null,
  sent: DevicePairing,
): string | null {
  if (shown === null) {
    return 'This Mac is not available. Try again once it connects.'
  }
  return equalPairing(shown, sent)
    ? null
    : 'This Mac reconnected before the change reached it. Try again.'
}

const titles = {
  'remove-command': {
    done: 'Removed',
    'done-not-saved': 'Removed, not saved',
    failed: 'Not removed',
  },
  'stop-workspace': {
    done: 'Stopped',
    'done-not-saved': 'Stopped, not saved',
    failed: 'Not stopped',
  },
  'extend-workspace': {
    done: 'Extended',
    'done-not-saved': 'Extended, not saved',
    failed: 'Not extended',
  },
  'keep-workspace': {
    done: 'Kept until you stop',
    'done-not-saved': 'Kept, not saved',
    failed: 'Not kept',
  },
} as const satisfies Record<
  SettingsChange['action'],
  Record<DeviceSettingsOutcome['status'], string>
>

/** What became of the change, in a few words. */
export function resultTitle(result: ChangeResult): string {
  return titles[result.change.action][result.outcome.status]
}

/** The cause that the Mac gave, or null for a change that it saved. */
export function resultMessage(result: ChangeResult): string | null {
  return result.outcome.status === 'done' ? null : result.outcome.message
}
