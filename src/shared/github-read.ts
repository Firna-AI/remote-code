import type { GitHubSummary } from './generated/GitHubSummary'

/** Each GitHub state. The `satisfies` check keeps the list in step. */
const summaries = {
  'checks-running': true,
  'checks-failed': true,
  'ready-to-merge': true,
  merged: true,
  conflict: true,
  'changes-requested': true,
  draft: true,
  blocked: true,
} as const satisfies Record<GitHubSummary, true>

/** A known GitHub state, or null for an absent or unknown value. */
export function readGitHubSummary(value: unknown): GitHubSummary | null {
  return typeof value === 'string' && Object.hasOwn(summaries, value)
    ? (value as GitHubSummary)
    : null
}
