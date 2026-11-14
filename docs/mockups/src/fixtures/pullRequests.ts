import type { GitHubSummary } from '../../../../src/shared/generated/GitHubSummary'

/**
 * The GitHub state of the open workspace branch: its pull request and the
 * checks that GitHub reports for it.
 */

/**
 * The states of the pull request bar (decisions 18 and 64). `none` is a
 * branch without a pull request, and `no-commits` is one without a commit,
 * which has nothing to open a pull request with. `blocked` is a pull
 * request that GitHub blocks for a reason that no other state names.
 */
export const bannerStates = [
  'none',
  'no-commits',
  'checks-running',
  'checks-failed',
  'ready-to-merge',
  'merged',
  'conflict',
  'changes-requested',
  'draft',
  'closed',
  'blocked',
] as const

export type BannerState = (typeof bannerStates)[number]

export type PullRequest = {
  number: number
  title: string
  url: string
}

export const pullRequest: PullRequest = {
  number: 482,
  title: 'Add address autocomplete to checkout',
  url: 'https://github.com/acme/storefront/pull/482',
}

type CheckState = 'passed' | 'failed' | 'running'

export type Check = {
  name: string
  state: CheckState
  /** How long a finished check ran. */
  duration?: string
}

function passed(name: string, duration: string): Check {
  return { name, state: 'passed', duration }
}

const allPassed: readonly Check[] = [
  passed('build', '1m 12s'),
  passed('lint', '24s'),
  passed('typecheck', '41s'),
  passed('unit', '1m 03s'),
  passed('e2e (chromium)', '3m 38s'),
  passed('e2e (webkit)', '3m 52s'),
]

/** The checks of the pull request in each banner state, in GitHub's order. */
export const checksByState: Readonly<Record<BannerState, readonly Check[]>> = {
  none: [],
  'no-commits': [],
  'checks-running': [
    ...allPassed.slice(0, 4),
    { name: 'e2e (chromium)', state: 'running' },
    { name: 'e2e (webkit)', state: 'running' },
  ],
  'checks-failed': [
    passed('build', '1m 12s'),
    { name: 'lint', state: 'failed', duration: '22s' },
    passed('typecheck', '41s'),
    passed('unit', '1m 03s'),
    { name: 'e2e (chromium)', state: 'failed', duration: '3m 40s' },
    passed('e2e (webkit)', '3m 52s'),
  ],
  'ready-to-merge': allPassed,
  merged: allPassed,
  conflict: allPassed,
  'changes-requested': allPassed,
  draft: allPassed,
  closed: allPassed,
  blocked: allPassed,
}

/**
 * The GitHub state of the pull request in a banner state: the bar state
 * itself. A branch without a pull request and a pull request closed without
 * a merge have none.
 */
export function bannerSummary(state: BannerState): GitHubSummary | null {
  return state === 'none' || state === 'no-commits' || state === 'closed'
    ? null
    : state
}

/** The review state that GitHub reports, when the pull request has one. */
export const reviewByState: Readonly<Record<BannerState, string | undefined>> =
  {
    none: undefined,
    'no-commits': undefined,
    'checks-running': undefined,
    'checks-failed': undefined,
    'ready-to-merge': 'Approved',
    merged: 'Approved',
    conflict: undefined,
    'changes-requested': 'Changes requested',
    draft: undefined,
    closed: undefined,
    /** A missing approval is the common reason that GitHub blocks a merge. */
    blocked: 'Pending',
  }

export const mergedInto = { branch: 'main', when: '2h ago' }

/** The reviewer who asked for changes, by GitHub login. */
export const changesRequestedBy = 'priyaraman'

/** When the pull request closed without a merge. */
export const closedWhen = '1d ago'
