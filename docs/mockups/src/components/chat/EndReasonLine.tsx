import { TimerOff, type LucideIcon } from 'lucide-react'
import type { TurnEndReason } from '../../../../../src/shared/generated/TurnEndReason'
import { endReasonText } from './endReasonCopy'
import styles from './LinkedLine.module.css'

const icons: Readonly<Record<TurnEndReason, LucideIcon>> = {
  background_work_limit: TimerOff,
}

/**
 * The line of the end reason of a finished turn, which names what ended the
 * turn. It is centred and muted, as the other event lines of the chat, and
 * a narrow chat wraps it into balanced lines. It takes no fixtures, so the
 * app can use it too.
 */
export function EndReasonLine(props: { reason: TurnEndReason }) {
  const Icon = icons[props.reason]
  return (
    <p className={styles.line}>
      <Icon aria-hidden className={styles.icon} size={13} />
      <span>{endReasonText(props.reason)}</span>
    </p>
  )
}
