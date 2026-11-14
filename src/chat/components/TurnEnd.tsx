import { CircleSlash, FileText } from 'lucide-react'
import type { TurnEndReason } from '../../shared/generated/TurnEndReason'
import type { ChangedFile } from '../../shared/generated/ChangedFile'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import { DiffStat } from '../../../docs/mockups/src/components/files/DiffStat'
import { EndReasonLine } from '../../../docs/mockups/src/components/chat/EndReasonLine'
import { turnFilesUnavailable } from '../../../docs/mockups/src/components/chat/lostCopy'
import type { StandardSpeedCause } from '../../../docs/mockups/src/components/chat/speedCopy'
import { StandardSpeedNote } from '../../../docs/mockups/src/components/chat/StandardSpeedNote'
import styles from '../../../docs/mockups/src/components/chat/TurnEnd.module.css'
import { TurnFileList } from '../../../docs/mockups/src/components/chat/TurnFileList'
import { formatDuration } from '../../shared/transcript/duration'
import { turnCopy } from '../../shared/transcript/turn-words'
import controls from '../ui/controls.module.css'
import local from './chat.module.css'

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * A changed file of the turn. It shows the label of its path, which hides
 * each secret value, and it opens the diff of its real path. It shows the
 * lines that the file adds and removes only when one count is above zero,
 * so a file without line changes, such as a binary file, has no "+0". The Worker
 * leaves the label out when it equals the real path.
 */
function FileChip(props: {
  file: ChangedFile
  onOpenDiff?: (path: string) => void
}) {
  const { file, onOpenDiff } = props
  const label = file.displayPath ?? file.path
  const content = (
    <>
      <FileText className={styles.icon} size={12} />
      {fileName(label)}
      {file.added > 0 || file.removed > 0 ? (
        <DiffStat added={file.added} removed={file.removed} />
      ) : null}
    </>
  )
  if (!onOpenDiff) return <span className={styles.chip}>{content}</span>
  return (
    <button
      aria-label={`Open the changes of ${label}`}
      className={classes(controls.bare, styles.chip, local.chipButton)}
      onClick={() => onOpenDiff(file.path)}
      type="button"
    >
      {content}
    </button>
  )
}

/**
 * The end of a finished turn: how long it ran, and the files that it changed.
 * Each file opens its diff when the app gives `onOpenDiff`. `TurnFileList`
 * shows the first chips and a button for the rest. The runner lists at most
 * 200 files of a turn, and `omittedFiles` counts the rest. `filesUnavailable`
 * says that the cloud computer could not read the changed files, in place of
 * the list. The turn still finished.
 * `endReason` names a cause other than the end of the reply, such as the
 * time limit of background work. Its line sits above the row, as in the
 * mockups. `standardSpeed` marks a fast turn that ran at standard speed,
 * with the cause that the note can name: the note stands beside the
 * duration, which it explains, and the files go under it.
 */
export function TurnEnd(props: {
  durationMs: number
  files: readonly ChangedFile[]
  omittedFiles: number
  filesUnavailable: boolean
  endReason?: TurnEndReason
  standardSpeed?: { cause?: StandardSpeedCause }
  onOpenDiff?: (path: string) => void
}) {
  const more = props.omittedFiles
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
          label={turnCopy.files}
          omittedFiles={more}
          renderChip={(file) => (
            <FileChip file={file} onOpenDiff={props.onOpenDiff} />
          )}
        />
      ) : null}
    </>
  )
  const row = (
    <div className={styles.end}>
      <span className={styles.duration}>
        {formatDuration(props.durationMs)}
      </span>
      {props.standardSpeed === undefined ? (
        files
      ) : (
        <div className={styles.facts}>
          <StandardSpeedNote cause={props.standardSpeed.cause} />
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
