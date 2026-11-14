import type { GitHubSummary } from '../../../../../src/shared/generated/GitHubSummary'
import type { ActivityStatus } from '../../fixtures/workspaces'

/**
 * How a row title shows its state: strong for output that the user has not
 * read, active while an agent works, and dim while the sandbox is stopped.
 */
type RowEmphasis = 'strong' | 'active' | 'normal' | 'dim'

export type StatusPresentation = {
  /** The state in words: the header shows it, and screen readers hear it. */
  label: string
  emphasis: RowEmphasis
}

export const activityPresentation: Readonly<
  Record<ActivityStatus, StatusPresentation>
> = {
  working: { label: 'Working', emphasis: 'active' },
  input: { label: 'Needs input', emphasis: 'active' },
  unread: { label: 'Done, unread', emphasis: 'strong' },
  ready: { label: 'Ready', emphasis: 'normal' },
  starting: { label: 'Starting', emphasis: 'normal' },
  stopped: { label: 'Stopped', emphasis: 'dim' },
  error: { label: "Couldn't start", emphasis: 'normal' },
  archived: { label: 'Archived', emphasis: 'dim' },
}

/** The GitHub state in words, which only the colour of the list mark shows. */
const githubLabels: Readonly<Record<GitHubSummary, string>> = {
  'checks-running': 'Checks running',
  'checks-failed': 'Checks failed',
  'ready-to-merge': 'Ready to merge',
  merged: 'Merged',
  conflict: 'Merge conflict',
  'changes-requested': 'Changes requested',
  draft: 'Draft',
  blocked: 'Blocked',
}

/**
 * What screen readers hear for the list mark of a row, a palette row, or a
 * chip: the GitHub state, then the state of the workspace, such as
 * "Checks failed, Working". A workspace without a GitHub state gives only
 * its state. The mark of an archived workspace shows no colour, so its
 * words leave out the GitHub state too.
 */
export function listMarkLabel(
  github: GitHubSummary | null,
  status: ActivityStatus,
): string {
  const state = activityPresentation[status].label
  if (github === null || status === 'archived') return state
  return `${githubLabels[github]}, ${state}`
}
