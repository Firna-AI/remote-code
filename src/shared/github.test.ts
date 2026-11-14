import type { GitHubSummary } from './generated/GitHubSummary'
import { expect, it } from 'vitest'

import {
  checksSummary,
  githubSummary,
  type ChecksSummary,
  type BannerState,
  type GitHubBanner,
  type GitHubCheck,
} from './github'

function banner(state: BannerState): GitHubBanner {
  const common = { branch: 'changes', baseBranch: 'main', updatedAt: 1 }
  if (state === 'none' || state === 'no-commits')
    return { ...common, state, pullRequest: null }
  return {
    ...common,
    state,
    pullRequest: {
      number: 1,
      title: 'Changes',
      url: 'https://github.com/a/b/pull/1',
      headSha: 'changes-head',
    },
    review: null,
    changesRequestedBy: [],
    mergedAt: state === 'merged' ? 1 : null,
    closedAt: state === 'closed' ? 1 : null,
  }
}

function check(state: GitHubCheck['state']): GitHubCheck {
  return {
    id: state,
    name: state,
    state,
    url: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  }
}

const checkCases: readonly {
  scenario: string
  checks: readonly GitHubCheck['state'][]
  expected: ChecksSummary | null
}[] = [
  {
    scenario: 'failure wins over running',
    checks: ['running', 'failed'],
    expected: 'checks-failed',
  },
  {
    scenario: 'cancelled fails',
    checks: ['cancelled'],
    expected: 'checks-failed',
  },
  {
    scenario: 'timed-out fails',
    checks: ['timed-out'],
    expected: 'checks-failed',
  },
  {
    scenario: 'action-required fails',
    checks: ['action-required'],
    expected: 'checks-failed',
  },
  {
    scenario: 'queued runs',
    checks: ['queued', 'passed'],
    expected: 'checks-running',
  },
  { scenario: 'running runs', checks: ['running'], expected: 'checks-running' },
  {
    scenario: 'skipped and neutral pass',
    checks: ['skipped', 'neutral', 'passed'],
    expected: 'checks-passed',
  },
  { scenario: 'no checks', checks: [], expected: null },
]

it.each(checkCases)('summarizes checks: $scenario', ({ checks, expected }) => {
  expect(checksSummary(checks.map(check))).toBe(expected)
})

const states: readonly {
  state: BannerState
  expected: GitHubSummary | null
}[] = [
  { state: 'none', expected: null },
  { state: 'no-commits', expected: null },
  { state: 'closed', expected: null },
  ...(
    [
      'checks-running',
      'checks-failed',
      'ready-to-merge',
      'merged',
      'conflict',
      'changes-requested',
      'draft',
      'blocked',
    ] as const
  ).map((state) => ({ state, expected: state })),
]

it.each(states)(
  'gives the list the bar state $state as $expected',
  ({ state, expected }) => {
    expect(githubSummary(banner(state))).toBe(expected)
  },
)
