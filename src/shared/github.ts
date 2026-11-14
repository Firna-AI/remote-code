import type { GitHubSummary } from './generated/GitHubSummary'
import type { Timestamp } from './generated/Timestamp'
import { workspacePath } from './workspaces'

export const githubPaths = {
  banner: (orgId: string, id: string) => `${workspacePath(orgId, id)}/github`,
  checks: (orgId: string, id: string) =>
    `${workspacePath(orgId, id)}/github/checks`,
  stored: (orgId: string, id: string) =>
    `${workspacePath(orgId, id)}/github/stored`,
  capabilities: (orgId: string, id: string) =>
    `${workspacePath(orgId, id)}/github/capabilities`,
  merge: (orgId: string, id: string) =>
    `${workspacePath(orgId, id)}/github/merge`,
  mergeResult: (orgId: string, id: string, mergeId: string) =>
    `${workspacePath(orgId, id)}/github/merge/${encodeURIComponent(mergeId)}`,
} as const

export interface PullRequest {
  number: number
  title: string
  url: string
  headSha: string
}
export type GitHubMergeMethod = 'merge' | 'squash' | 'rebase'
export interface GitHubCapabilities {
  canWrite: boolean
  mergeMethod: GitHubMergeMethod | null
}
export interface GitHubMergeRequest {
  headSha: string
  method: GitHubMergeMethod
}
export type GitHubMergeResponse =
  { state: 'pending'; mergeId: string } | { state: 'merged' }
export type BannerState =
  | 'none'
  | 'no-commits'
  | 'checks-running'
  | 'checks-failed'
  | 'ready-to-merge'
  | 'merged'
  | 'conflict'
  | 'changes-requested'
  | 'draft'
  | 'closed'
  /** GitHub blocks the merge, and no other state applies. */
  | 'blocked'

export type GitHubBanner = {
  branch: string
  baseBranch: string
  updatedAt: Timestamp
} & (
  | {
      state: 'none' | 'no-commits'
      pullRequest: null
    }
  | {
      state: Exclude<BannerState, 'none' | 'no-commits'>
      pullRequest: PullRequest
      review: 'approved' | 'changes-requested' | 'pending' | null
      changesRequestedBy: readonly string[]
      mergedAt: Timestamp | null
      closedAt: Timestamp | null
    }
)

export interface GitHubCheck {
  id: string
  name: string
  state:
    | 'queued'
    | 'running'
    | 'passed'
    | 'failed'
    | 'cancelled'
    | 'skipped'
    | 'neutral'
    | 'action-required'
    | 'timed-out'
  url: string | null
  startedAt: Timestamp | null
  completedAt: Timestamp | null
  durationMs: number | null
}

/** The checks of a pull request, as one value. */
export type ChecksSummary = 'checks-running' | 'checks-failed' | 'checks-passed'

/**
 * The checks as one value, or null without a check: a failure wins over a
 * check that runs. Checks passed means that each check counts as passed.
 */
export function checksSummary(
  checks: readonly GitHubCheck[],
): ChecksSummary | null {
  if (
    checks.some((check) =>
      ['failed', 'cancelled', 'timed-out', 'action-required'].includes(
        check.state,
      ),
    )
  )
    return 'checks-failed'
  if (
    checks.some(
      (check) => check.state === 'queued' || check.state === 'running',
    )
  )
    return 'checks-running'
  return checks.length > 0 ? 'checks-passed' : null
}

export function githubSummary(banner: GitHubBanner): GitHubSummary | null {
  const { state } = banner
  return state === 'none' || state === 'no-commits' || state === 'closed'
    ? null
    : state
}

export interface GitHubBannerResponse {
  banner: GitHubBanner
}
export interface GitHubChecksResponse {
  state: 'waiting-for-pull-request' | 'available'
  /** Preserve GitHub's order. */
  checks: readonly GitHubCheck[]
}
/**
 * The last GitHub state that the Worker stored for the workspace branch,
 * without a GitHub read. Null before the first read of the branch.
 */
export interface GitHubStoredResponse {
  state: { banner: GitHubBanner; checks: GitHubChecksResponse } | null
}
