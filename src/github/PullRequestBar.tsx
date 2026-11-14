import { CircleAlert } from 'lucide-react'
import type { Timestamp } from '../shared/generated/Timestamp'
import { ActionButton } from './ActionButton'
import {
  Branches,
  classes,
  loadFailedText,
  loadingText,
  MutedSpinner,
  PullRequestNumber,
  StateLabel,
} from './bannerParts'
import { bannerDetail, bannerStatus } from './bannerStatus'
import { BarButtons, BarMessageLine } from './BarButtons'
import type { CommandKeyOf } from './barKeys'
import type { BarControls } from './barView'
import type { GitHubFeed } from './githubStore'
import styles from './PullRequestBar.module.css'

export interface PullRequestBarProps {
  github: GitHubFeed
  /** The clock of the relative times, such as the time of the merge. */
  now: Timestamp
  /**
   * The actions, the link, and the message of the GitHub state that shows,
   * from the one action state of the screen. Null while no state shows.
   */
  controls: BarControls | null
  /**
   * The key of the command of each button and of the number, which their
   * tooltips show, as `CommandKeyOf` says.
   */
  keyOf?: CommandKeyOf
}

function Pending() {
  return (
    <div className={styles.bar}>
      <span className={styles.pending}>
        <MutedSpinner size={12} />
        {loadingText}
      </span>
    </div>
  )
}

/**
 * The pull request bar at the top of the right column. It shows the GitHub
 * state of the workspace branch and its main action. The number of a pull
 * request opens it on GitHub. A branch without a pull request shows its
 * target and Create PR. A message, such as a refusal of GitHub, shows under
 * the bar. Beside an action, a narrow bar drops its detail.
 */
export function PullRequestBar(props: PullRequestBarProps) {
  const { state, retry } = props.github
  const { controls } = props
  if (state.status === 'loading') return <Pending />
  if (state.status === 'error') {
    return (
      <div className={styles.bar}>
        <span className={styles.problem}>
          <CircleAlert aria-hidden className={styles.alert} size={14} />
          {loadFailedText}
        </span>
        <span className={styles.spacer} />
        <ActionButton onPress={retry}>Try again</ActionButton>
      </div>
    )
  }
  if (!controls) return <Pending />
  const { banner, checks } = state.snapshot
  const { view } = controls
  const withActions = view.actions.length > 0 && styles.withActions
  const message = view.message ? (
    <BarMessageLine keyOf={props.keyOf} message={view.message} />
  ) : null
  // The number of a pull request links to it, so the bar shows no other link.
  const actions = (
    <span className={styles.actions}>
      <BarButtons controls={controls} keyOf={props.keyOf} link={false} />
    </span>
  )
  if (banner.pullRequest === null) {
    return (
      <>
        <div className={classes(styles.bar, withActions)}>
          <Branches banner={banner} />
          {view.note ? (
            <span className={styles.note}>{view.note}</span>
          ) : (
            actions
          )}
        </div>
        {message}
      </>
    )
  }
  const status = bannerStatus(banner, checks.checks)
  const detail = bannerDetail(banner, checks.checks, props.now)
  return (
    <>
      <div className={classes(styles.bar, styles[status.tone], withActions)}>
        <PullRequestNumber
          href={banner.pullRequest.url}
          keyOf={props.keyOf}
          number={banner.pullRequest.number}
        />
        <StateLabel status={status} />
        {detail ? (
          <span className={styles.detail} title={detail}>
            {detail}
          </span>
        ) : null}
        {actions}
      </div>
      {message}
    </>
  )
}
