import { Loader } from '@firna/ui/loader'
import { useSharedUiTheme } from '@firna/ui/theme'
import type { LucideIcon } from 'lucide-react'
import { Archive, CircleAlert, CirclePause } from 'lucide-react'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import { Notice } from '../../../docs/mockups/src/components/common/Notice'
import styles from '../../../docs/mockups/src/components/workspace/StartingCard.module.css'
import { formatDuration } from '../../shared/transcript/duration'
import { formatDay } from '../state/format'
import { ActionButton } from '../ui/actions'

/**
 * The start of a sandbox at the end of the chat: a quiet card with a moving
 * mark, each step so far, and the time since the start began.
 */
export function StartingCard(props: {
  start: WorkspaceStart | null
  now: number
}) {
  const theme = useSharedUiTheme()
  const { start } = props
  const title =
    start?.kind === 'resume' ? 'Resuming the sandbox' : 'Starting the sandbox'
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
          {(start?.steps ?? []).map((step) => (
            <li key={step.id}>
              <span aria-hidden className={styles.caret}>
                ›
              </span>
              {step.label}
            </li>
          ))}
        </ol>
        {start ? (
          <span className={styles.elapsed}>
            {formatDuration(props.now - start.startedAt)}
          </span>
        ) : null}
      </div>
    </section>
  )
}

export type SandboxProblem = 'stopped' | 'error' | 'archived'

interface Problem {
  icon: LucideIcon
  title: string
  body: string
  /** The one way forward, when the sandbox can come back. */
  action?: string
  tone: 'neutral' | 'danger'
}

const saved = 'Your files and chat are saved.'

/**
 * A failed first start leaves a new workspace with no files yet, so its bar
 * promises only the chat, with its queued messages.
 */
const chatSaved = 'Your chat is saved.'

function problemOf(
  problem: SandboxProblem,
  archivedAt: number | null,
): Problem {
  switch (problem) {
    case 'stopped':
      return {
        icon: CirclePause,
        title: 'Sandbox stopped',
        body: saved,
        action: 'Resume',
        tone: 'neutral',
      }
    case 'error':
      return {
        icon: CircleAlert,
        title: "The sandbox couldn't start",
        body: saved,
        action: 'Try again',
        tone: 'danger',
      }
    case 'archived':
      return {
        icon: Archive,
        title:
          archivedAt === null
            ? 'Archived'
            : `Archived on ${formatDay(archivedAt)}`,
        body: 'Its cloud computer is deleted, and the chat is read-only.',
        tone: 'neutral',
      }
  }
}

/**
 * The bar under the chat while the sandbox does not run: Resume when it
 * stopped, Try again when it did not start, and the read-only chat of an
 * archived workspace. A failed start shows the message that the workspace
 * saved for it first. The bar takes the place of the composer, except after
 * a failed first start, whose composer stays under it.
 */
export function SandboxBar(props: {
  problem: SandboxProblem
  archivedAt: number | null
  /** The message that the workspace saved for a failed start, or null. */
  message: string | null
  /** The failed first start of a new workspace, which has no files yet. */
  firstStart: boolean
  busy: boolean
  onResume: () => void
}) {
  const problem = problemOf(props.problem, props.archivedAt)
  const failed = props.problem === 'error'
  const kept = failed && props.firstStart ? chatSaved : problem.body
  const body = failed && props.message ? `${props.message} ${kept}` : kept
  return (
    <Notice
      action={
        problem.action ? (
          <ActionButton
            busy={props.busy}
            onPress={props.onResume}
            tone="primary"
          >
            {problem.action}
          </ActionButton>
        ) : undefined
      }
      body={body}
      icon={problem.icon}
      title={problem.title}
      tone={problem.tone}
    />
  )
}
