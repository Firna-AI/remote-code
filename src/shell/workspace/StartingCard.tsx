import { Loader } from '@firna/ui/loader'
import { useSharedUiTheme } from '@firna/ui/theme'
import type { StartStep } from '../../shared/generated/StartStep'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import styles from '../../../docs/mockups/src/components/workspace/StartingCard.module.css'
import { formatElapsed, useNow } from '../../app/time'
import workspace from './workspace.module.css'

/**
 * The time of a finished step. The step that runs has none, because the
 * time since the start counts it.
 */
function stepTime(step: StartStep): string | null {
  if (step.state === 'failed') return 'failed'
  if (step.completedAt === null) return null
  return formatElapsed(step.completedAt - step.startedAt)
}

/**
 * The start of a sandbox at the end of the chat: a quiet card with a moving
 * mark, then each step so far with its time, and the time since the start
 * began. The steps come from the workspace as they happen.
 */
export function StartingCard(props: { start: WorkspaceStart }) {
  const theme = useSharedUiTheme()
  const now = useNow(1_000)
  const { start } = props
  const title =
    start.kind === 'create' ? 'Starting the sandbox' : 'Resuming the sandbox'
  return (
    <section aria-label={title} className={styles.starting}>
      <div className={styles.card}>
        <Loader
          accessibilityLabel={title}
          color={theme.colors.muted}
          size={14}
          variant="dot-grid"
        />
        {title}
      </div>
      <div className={styles.log}>
        <ol className={styles.steps}>
          {start.steps.map((step) => {
            const time = stepTime(step)
            return (
              <li className={workspace.step} key={step.id}>
                <span className={workspace.stepLabel}>
                  <span aria-hidden className={styles.caret}>
                    ›
                  </span>
                  {step.label}
                </span>
                {time ? (
                  <span className={workspace.stepTime}>{time}</span>
                ) : null}
              </li>
            )
          })}
        </ol>
        <span className={styles.elapsed}>
          <span className={workspace.hidden}>Since the start: </span>
          {formatElapsed(now - start.startedAt)}
        </span>
      </div>
    </section>
  )
}
