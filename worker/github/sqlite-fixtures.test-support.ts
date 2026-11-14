import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { GitHubSnapshot } from './contracts'

export const SQLITE_WORKSPACE_ID = 'github-workspace'
export const SQLITE_TIME = 1_800_000_000_000
export const SQLITE_CHOICE: AgentChoice = {
  agent: 'claude',
  model: 'test-claude',
  effort: 'high',
  fast: false,
}

export function sqliteSnapshot(large = false): GitHubSnapshot {
  return {
    banner: {
      state: 'no-commits',
      branch: 'owner/workspace',
      baseBranch: 'main',
      updatedAt: 1,
      pullRequest: null,
    },
    checks: large
      ? {
          state: 'available',
          checks: Array.from({ length: 5000 }, (_, index) => ({
            id: `check-${index}`,
            name: `Storage integration ${index} ${'check'.repeat(16)}`,
            state: 'passed',
            url: `https://github.com/owner/repository/actions/runs/123456789/job/${index}`,
            startedAt: SQLITE_TIME,
            completedAt: SQLITE_TIME + 1000,
            durationMs: 1000,
          })),
        }
      : { state: 'waiting-for-pull-request', checks: [] },
    headSha: null,
  }
}

export function sqlitePullSnapshot(): GitHubSnapshot {
  return {
    banner: {
      state: 'ready-to-merge',
      branch: 'owner/workspace',
      baseBranch: 'main',
      updatedAt: 1,
      pullRequest: {
        number: 1,
        title: 'Summary copy',
        url: 'https://github.com/owner/repo/pull/1',
        headSha: 'pull-head',
      },
      review: 'approved',
      changesRequestedBy: [],
      mergedAt: null,
      closedAt: null,
    },
    checks: {
      state: 'available',
      checks: [
        {
          id: 'build',
          name: 'Build',
          state: 'passed',
          url: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
        },
      ],
    },
    headSha: 'pull-head',
  }
}
