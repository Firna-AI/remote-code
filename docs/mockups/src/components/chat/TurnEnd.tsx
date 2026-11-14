import { CircleSlash, FileText } from 'lucide-react'
import type { TurnEndReason } from '../../../../../src/shared/generated/TurnEndReason'
import { splitPath, type ChangedFile } from '../../fixtures/files'
import { ScreenLink } from '../common/ScreenLink'
import { DiffStat } from '../files/DiffStat'
import { paths } from '../../paths'
import { EndReasonLine } from './EndReasonLine'
import { turnFilesUnavailable } from './lostCopy'
import type { StandardSpeedCause } from './speedCopy'
import { StandardSpeedNote } from './StandardSpeedNote'
import styles from './TurnEnd.module.css'
import { TurnFileList } from './TurnFileList'

/**
 * A changed file of the turn. It shows the lines that the file adds and
 * removes only when one count is above zero, so a file without line
 * changes, such as a binary file, has no "+0".
 */
function FileChip(props: { file: ChangedFile }) {
  const { file } = props
  const content = (
    <>
      <FileText className={styles.icon} size={12} />
      {splitPath(file.path).name}
      {file.added > 0 || file.removed > 0 ? (
        <DiffStat added={file.added} removed={file.removed} />
      ) : null}
    </>
  )
  if (!file.diff) return <span className={styles.chip}>{content}</span>
  return (
    <ScreenLink className={styles.chip} to={paths.diff}>
      {content}
    </ScreenLink>
  )
}

/**
 * The end of a finished turn: how long it ran, and the files it changed.
 * `TurnFileList` shows the first chips and a button for the rest. The
 * runner lists at most 200 files of a turn. `omittedFiles` counts the rest.
 * `filesUnavailable` marks a turn whose changed files the cloud computer
 * could not read: the turn still ends with its duration, and plain text
 * takes the place of the chips.
 * `endReason` names a cause other than the end of the reply, such as the
 * time limit of background work: its line sits above the row.
 * `standardSpeed` names why a fast turn ran at standard speed: its note
 * stands beside the duration, which it explains, and the files go under it.
 */
export function TurnEnd(props: {
  duration: string
  files: readonly ChangedFile[]
  omittedFiles?: number
  filesUnavailable?: boolean
  endReason?: TurnEndReason
  standardSpeed?: StandardSpeedCause
}) {
  const more = props.omittedFiles ?? 0
  const files = (
    <>
      {props.filesUnavailable ? (
        <span className={styles.unavailable}>
          <CircleSlash aria-hidden className={styles.icon} size={12} />
          {turnFilesUnavailable}
        </span>
      ) : null}
      {props.files.length > 0 || more > 0 ? (
        <TurnFileList
          files={props.files}
          label="Files this turn changed"
          omittedFiles={more}
          renderChip={(file) => <FileChip file={file} />}
        />
      ) : null}
    </>
  )
  const row = (
    <div className={styles.end}>
      <span className={styles.duration}>{props.duration}</span>
      {props.standardSpeed === undefined ? (
        files
      ) : (
        <div className={styles.facts}>
          <StandardSpeedNote cause={props.standardSpeed} />
          {files}
        </div>
      )}
    </div>
  )
  if (props.endReason === undefined) return row
  return (
    <div className={styles.ended}>
      <EndReasonLine reason={props.endReason} />
      {row}
    </div>
  )
}
