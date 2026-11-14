import {
  SquareDot,
  SquareMinus,
  SquarePlus,
  type LucideIcon,
} from 'lucide-react'
import type { ChangeKind } from '../../shared/generated/ChangeKind'
import styles from './ChangeIcon.module.css'

/**
 * The squares of the mockups. A rename shows as a change and an untracked
 * file as an addition. The name of the mark tells them apart.
 */
const icons: Readonly<Record<ChangeKind, LucideIcon>> = {
  added: SquarePlus,
  modified: SquareDot,
  deleted: SquareMinus,
  renamed: SquareDot,
  untracked: SquarePlus,
}

export const changeLabels: Readonly<Record<ChangeKind, string>> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'Untracked',
}

/** A small square that marks how a file changed. Its name says how. */
export function ChangeIcon(props: { change: ChangeKind; label?: string }) {
  const Icon = icons[props.change]
  return (
    <Icon
      aria-hidden={false}
      aria-label={props.label ?? changeLabels[props.change]}
      className={styles[props.change]}
      role="img"
      size={13}
    />
  )
}
