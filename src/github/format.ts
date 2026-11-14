import type { Timestamp } from '../shared/generated/Timestamp'
const second = 1_000
const minute = 60 * second
const hour = 60 * minute
const day = 24 * hour

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** How long a check ran, as the mockups write it: 24s, 1m 03s, or 1h 02m. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / second))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${twoDigits(seconds % 60)}s`
  return `${Math.floor(minutes / 60)}h ${twoDigits(minutes % 60)}m`
}

/** A past time before `now`: just now, 5m ago, 2h ago, or 1d ago. */
export function formatTimeAgo(time: Timestamp, now: Timestamp): string {
  const elapsed = now - time
  if (elapsed < minute) return 'just now'
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`
  return `${Math.floor(elapsed / day)}d ago`
}

/** A count with its noun: 1 check, or 2 checks. */
export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
