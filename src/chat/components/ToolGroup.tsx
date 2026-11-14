import { useState } from 'react'
import { Spinner } from '@firna/ui/spinner'
import { useSharedUiTheme } from '@firna/ui/theme'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronRight,
  FilePen,
  FilePlus,
  FileText,
  Monitor,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react'
import type { ToolCall } from '../../shared/generated/ToolCall'
import {
  foldLabel,
  toolEnding,
  toolVerb,
} from '../../shared/transcript/tool-words'
import { LeftOut } from '../../../docs/mockups/src/components/chat/LeftOut'
import {
  leftOutOfCall,
  leftOutOfRun,
} from '../../../docs/mockups/src/components/chat/lostCopy'
import styles from '../../../docs/mockups/src/components/chat/ToolGroup.module.css'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import { useFold, type Fold } from './useFold'

const icons: Readonly<Record<ToolCall['kind'], LucideIcon>> = {
  read: FileText,
  search: Search,
  create: FilePlus,
  edit: FilePen,
  run: SquareTerminal,
  computer: Monitor,
  other: Wrench,
}

/** One tool call in an open list: its icon, its verb, its target, and its result. */
export function CallLine(props: { call: ToolCall }) {
  const theme = useSharedUiTheme()
  const { call } = props
  const Icon = icons[call.kind]
  const ending = toolEnding(call)
  return (
    <>
      <Icon className={styles.icon} size={13} />
      <span className={styles.verb}>{toolVerb(call)}</span>
      <span className={styles.target}>{call.target}</span>
      {call.detail ? (
        <span className={styles.detail}>{call.detail}</span>
      ) : null}
      {call.omittedDetailBytes > 0 ? (
        <LeftOut text={leftOutOfCall(call.omittedDetailBytes)} />
      ) : null}
      {call.state === 'running' ? (
        <Spinner color={theme.colors.muted} size={12} />
      ) : null}
      {ending ? <span className={styles.detail}>{ending}</span> : null}
    </>
  )
}

/**
 * The line of a fold: a chevron, the count of its tool calls and of its
 * messages, such as "8 tool calls, 7 messages", the icons of the kinds of
 * its tool calls, and the total output that the runner left out of them,
 * from the calls' current counts. It leaves out a zero count. A run of tool
 * calls and the work of an ended turn share it.
 */
export function FoldLine(props: {
  calls: readonly ToolCall[]
  messages?: number
  line: Fold['line']
}) {
  const { calls } = props
  const kinds = [...new Set(calls.map((call) => call.kind))]
  const leftOut = calls.reduce(
    (total, call) => total + call.omittedDetailBytes,
    0,
  )
  const label = foldLabel(calls.length, props.messages)
  return (
    <summary
      className={classes(styles.summary, leftOut > 0 && styles.wraps)}
      {...props.line}
    >
      <ChevronRight className={styles.chevron} size={14} />
      {label}
      {kinds.length > 0 ? (
        <span aria-hidden className={styles.kinds}>
          {kinds.map((kind) => {
            const Icon = icons[kind]
            return <Icon key={kind} size={13} />
          })}
        </span>
      ) : null}
      {leftOut > 0 ? <LeftOut text={leftOutOfRun(leftOut)} /> : null}
    </summary>
  )
}

/**
 * A run of consecutive tool calls as one line that folds them. `open` says
 * whether the run shows each call, as `groupEntries` decides: while a turn
 * runs, only its newest run does. Once the user opens or folds the run, it
 * keeps that choice, and its line keeps its place.
 */
export function ToolGroup(props: {
  calls: readonly ToolCall[]
  /** The run shows its calls until the user folds it. */
  open: boolean
}) {
  const { calls } = props
  const [chosen, setChosen] = useState<boolean | null>(null)
  const fold = useFold(chosen ?? props.open, setChosen)
  return (
    <details className={styles.group} {...fold.details}>
      <FoldLine calls={calls} line={fold.line} />
      <ul className={styles.calls}>
        {calls.map((call) => (
          <li className={styles.call} key={call.id}>
            <CallLine call={call} />
          </li>
        ))}
      </ul>
    </details>
  )
}
