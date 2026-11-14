import type { GitHubSummary } from '../../../../../src/shared/generated/GitHubSummary'
import type { ActivityStatus } from '../../fixtures/workspaces'
import { classes } from '../common/classes'
import { MarkGrid, ring, ringDelay, type MarkCell } from './MarkGrid'
import styles from './WorkspaceMark.module.css'

/**
 * The colour of each GitHub state: the tone of the pull request bar in the
 * same state.
 */
const colours: Readonly<Record<GitHubSummary, string>> = {
  'checks-running': styles.neutral,
  'checks-failed': styles.danger,
  'ready-to-merge': styles.success,
  merged: styles.merged,
  conflict: styles.warning,
  'changes-requested': styles.warning,
  draft: styles.neutral,
  blocked: styles.warning,
}

/** The middle column, which stays lit without motion while the agent asks. */
const column: readonly number[] = [1, 4, 7]

/**
 * The colour of the mark: the colour of the GitHub state, or dim grey
 * without one. An archived workspace keeps a faint mark without colour, so
 * that its chip shows the archive.
 */
function toneOf(github: GitHubSummary | null, status: ActivityStatus) {
  if (status === 'archived') return styles.archived
  return github === null ? styles.none : colours[github]
}

/**
 * Whether a light runs around the ring: while the agent works, and while
 * the checks run, so that the mark waits on something and the user does
 * not need to act. Needs input keeps its pulse, because the user must act.
 * An archived mark stays still.
 */
function chases(github: GitHubSummary | null, status: ActivityStatus) {
  if (status === 'working') return true
  if (status === 'input' || status === 'archived') return false
  return github === 'checks-running'
}

/**
 * How one cell looks. While the agent works or the checks run, a light
 * runs around the ring and the centre stays dim. While the agent needs
 * input, the whole grid pulses. Without motion, the ring of a working
 * agent or the middle column stays lit, and running checks light the whole
 * grid. Every other state is still: lit in the colour of the GitHub state,
 * or dim.
 */
function cellOf(
  github: GitHubSummary | null,
  status: ActivityStatus,
  cell: number,
): MarkCell {
  if (chases(github, status)) {
    return ring.includes(cell)
      ? {
          className: classes(styles.cell, styles.lit, styles.chase),
          style: ringDelay(cell),
        }
      : {
          className: classes(
            styles.cell,
            status !== 'working' && styles.litWhenStill,
          ),
        }
  }
  switch (status) {
    case 'input':
      return {
        className: classes(
          styles.cell,
          column.includes(cell) && styles.lit,
          styles.pulse,
        ),
      }
    case 'unread':
    case 'ready':
    case 'starting':
    case 'stopped':
    case 'error':
      return { className: classes(styles.cell, github !== null && styles.lit) }
    // `chases` already took the working agent.
    case 'working':
    case 'archived':
      return { className: styles.cell }
  }
}

/**
 * The mark of a workspace in the list, the command palette, and chips: the
 * GitHub state of its pull request in the colour of its pull request bar,
 * on the grid of `StatusGlyph`. Red is failed checks, green ready to merge,
 * purple a merge, and amber a merge conflict, requested changes, or a
 * block. Running checks and a draft are grey. A mark without a GitHub state
 * is dim grey.
 * A light runs around the ring while the agent works or the checks run,
 * and the mark pulses while the agent needs input. Every other mark is
 * still. It imports no fixture value, so the app uses it too.
 */
export function WorkspaceMark(props: {
  github: GitHubSummary | null
  status: ActivityStatus
}) {
  const { github, status } = props
  return (
    <MarkGrid
      cell={(cell) => cellOf(github, status, cell)}
      className={classes(styles.mark, toneOf(github, status))}
    />
  )
}
