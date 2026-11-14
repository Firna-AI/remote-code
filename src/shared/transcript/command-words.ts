import type { DeviceCommandRecord } from '../generated/DeviceCommandRecord'
import type { DeviceSender } from '../generated/DeviceSender'
import { deviceCommandSucceeded } from '../device'
import { formatDuration } from './duration'

export const commandCopy = {
  empty: 'The command printed nothing.',
  truncated: 'The output stops at its size limit. The agent got the same part.',
  in: 'in',
  upTo: 'up to',
} as const

/** A command that ran gives its output back to the agent. */
export function commandRan(request: DeviceCommandRecord): boolean {
  return request.state === 'completed' || request.state === 'timed-out'
}

/** The words of a count, such as "1 second" or "10 minutes". */
const count = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? '' : 's'}`

/** A time limit, such as "60 seconds", "2 minutes", or "10 minutes". */
export function limitLabel(seconds: number): string {
  if (seconds < 120) return count(seconds, 'second')
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (rest === 0) return count(minutes, 'minute')
  return `${count(minutes, 'minute')} ${count(rest, 'second')}`
}

/** The time left until a moment, as "14:32". */
export function timeLeft(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const rest = String(seconds % 60).padStart(2, '0')
  return `${Math.floor(seconds / 60)}:${rest}`
}

/** The name of a person, as the chat shows it. */
export function personName(sender: DeviceSender): string {
  return sender.displayName ?? sender.githubLogin
}

/**
 * The Mac that got a request: its name from the Mac app, or the Mac of the
 * sender when the record has no name.
 */
export function macName(request: DeviceCommandRecord): string {
  return request.deviceName ?? `${personName(request.sender)}'s Mac`
}

/** "This Mac" in the Mac app on the Mac that got the request, else its name. */
export function macLabel(request: DeviceCommandRecord, onThisMac: boolean) {
  return onThisMac ? 'This Mac' : macName(request)
}

/**
 * How long the command ran, from its start on the Mac to its result. The
 * wait for the answer does not count. Null when the record has no start.
 */
function runTime(request: DeviceCommandRecord): string | null {
  if (request.startedAt === null) return null
  return formatDuration(request.updatedAt - request.startedAt)
}

/** A request with a time limit above 120 seconds shows its reason at once. */
export function longerReason(request: DeviceCommandRecord): string | null {
  return request.timeoutSeconds > 120 ? request.longerTimeoutReason : null
}

function completedLabel(request: DeviceCommandRecord): string {
  const code = request.result?.exitCode ?? null
  const time = runTime(request)
  const after = time ? ` after ${time}` : ''
  if (deviceCommandSucceeded(request)) return time ? `Done in ${time}` : 'Done'
  if (code === null) return `Ended with no exit code${after}`
  return `Ended with exit code ${code}${after}`
}

/** The words of a command's state, without browser presentation. */
export function stateLabel(request: DeviceCommandRecord): string {
  switch (request.state) {
    case 'waiting':
      return 'Waiting for approval'
    case 'running':
      return 'Running'
    case 'completed':
      return completedLabel(request)
    case 'denied':
      return 'Denied'
    case 'unavailable':
      return 'Mac not available'
    case 'timed-out':
      return 'Stopped at the time limit'
    case 'failed':
      return 'Did not finish'
  }
}

/** The line under a command that says what happened, when the state needs one. */
export function stateNote(
  request: DeviceCommandRecord,
  viewerId: string | null,
): string | null {
  switch (request.state) {
    case 'denied':
      return request.sender.id === viewerId
        ? 'You denied it in the Mac app.'
        : `${personName(request.sender)} denied it in the Mac app.`
    case 'unavailable':
      return 'The Mac is asleep, or the Mac app is closed.'
    case 'timed-out':
      return `It ran for its time limit of ${limitLabel(request.timeoutSeconds)}.`
    case 'failed':
      return request.error?.message ?? 'The command did not run on the Mac.'
    default:
      return null
  }
}

/** The output that went back to the agent, or null when it printed nothing. */
export function outputOf(request: DeviceCommandRecord): string | null {
  const result = request.result
  if (!result) return null
  const text = [result.stdout, result.stderr]
    .filter((part) => part.length > 0)
    .join('\n')
  return text.length > 0 ? text : null
}
