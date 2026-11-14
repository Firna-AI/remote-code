import type { LucideIcon } from 'lucide-react'
import {
  Ban,
  CircleCheck,
  CircleX,
  GitMerge,
  GitMergeConflict,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquareWarning,
} from 'lucide-react'
import type { Timestamp } from '../shared/generated/Timestamp'
import type { GitHubBanner, GitHubCheck, PullRequest } from '../shared/github'
import { isFailedCheck, isFinishedCheck } from './checkStatus'
import { countOf, formatTimeAgo } from './format'

/** The banner of a branch that has a pull request. */
export type PullRequestBanner = Extract<
  GitHubBanner,
  { pullRequest: PullRequest }
>

/** A state tints the whole bar. Its edges stay neutral. */
type BannerTone = 'neutral' | 'success' | 'warning' | 'danger' | 'merged'

export interface BannerStatus {
  /** A spinner stands in place of the icon while checks run. */
  busy: boolean
  icon: LucideIcon | null
  text: string
  tone: BannerTone
}

/** The review that GitHub reports, in words. */
export function reviewLabel(
  review: PullRequestBanner['review'],
): string | null {
  switch (review) {
    case 'approved':
      return 'Approved'
    case 'changes-requested':
      return 'Changes requested'
    case 'pending':
      return 'Pending'
    case null:
      return null
  }
}

function reviewers(logins: readonly string[]): string | null {
  const [first, second] = logins
  if (first === undefined) return null
  if (second === undefined) return `by @${first}`
  if (logins.length === 2) return `by @${first} and @${second}`
  return `by @${first} and ${logins.length - 1} others`
}

function timeAgo(time: Timestamp | null, now: Timestamp): string | null {
  return time === null ? null : formatTimeAgo(time, now)
}

function still(icon: LucideIcon, text: string, tone: BannerTone): BannerStatus {
  return { busy: false, icon, text, tone }
}

/**
 * The state of a pull request in words, with its icon and its tint. A state
 * that waits for someone to act on GitHub takes the warning tone, and failed
 * checks take the danger tone.
 */
export function bannerStatus(
  banner: PullRequestBanner,
  checks: readonly GitHubCheck[],
): BannerStatus {
  switch (banner.state) {
    case 'checks-running':
      return { busy: true, icon: null, text: 'Checks running', tone: 'neutral' }
    case 'checks-failed': {
      const failed = checks.filter(isFailedCheck).length
      const text =
        failed > 0 ? `${countOf(failed, 'check')} failed` : 'Checks failed'
      return still(CircleX, text, 'danger')
    }
    case 'ready-to-merge':
      return still(CircleCheck, 'Ready to merge', 'success')
    case 'merged':
      return still(GitMerge, `Merged into ${banner.baseBranch}`, 'merged')
    case 'conflict':
      return still(GitMergeConflict, 'Merge conflict', 'warning')
    case 'changes-requested':
      return still(MessageSquareWarning, 'Changes requested', 'warning')
    case 'draft':
      return still(GitPullRequestDraft, 'Draft', 'neutral')
    case 'closed':
      return still(GitPullRequestClosed, 'Closed without a merge', 'neutral')
    case 'blocked':
      // GitHub names the reason on the pull request, so the bar names none.
      return still(Ban, 'Blocked', 'warning')
  }
}

/**
 * The detail that a wide bar shows after the words of the state: the checks
 * that finished, the review, the reviewers, or when the pull request ended.
 */
export function bannerDetail(
  banner: PullRequestBanner,
  checks: readonly GitHubCheck[],
  now: Timestamp,
): string | null {
  switch (banner.state) {
    case 'checks-running': {
      if (checks.length === 0) return null
      return `${checks.filter(isFinishedCheck).length} of ${checks.length}`
    }
    case 'ready-to-merge':
      return reviewLabel(banner.review)
    case 'merged':
      return timeAgo(banner.mergedAt, now)
    case 'conflict':
      return `with ${banner.baseBranch}`
    case 'changes-requested':
      return reviewers(banner.changesRequestedBy)
    case 'closed':
      return timeAgo(banner.closedAt, now)
    case 'checks-failed':
    case 'draft':
    case 'blocked':
      return null
  }
}
