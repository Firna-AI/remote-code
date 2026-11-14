import type { BranchChangedFile } from '../../shared/generated/BranchChangedFile'
import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import { pathLabel } from '../model/file-labels'
import { splitPath, type DiffTab, type FilesNavigation } from '../navigation'
import { ChangeIcon, changeLabels } from '../ui/ChangeIcon'
import { DiffStat } from '../ui/DiffStat'
import { FilesLink } from '../ui/FilesLink'
import { classes } from '../ui/classes'
import styles from './ChangeList.module.css'

function Row(props: {
  file: BranchChangedFile
  open: boolean
  navigation: FilesNavigation
}) {
  const { file } = props
  const { folder, name } = splitPath(pathLabel(file))
  const previous = file.previousDisplayPath ?? file.previousPath
  const label = previous
    ? `${changeLabels[file.change]} from ${previous}`
    : undefined
  const tab: DiffTab = { kind: 'diff', path: file.path }
  return (
    <FilesLink
      aria-current={props.open ? 'page' : undefined}
      className={classes(styles.row, props.open && styles.open)}
      navigation={props.navigation}
      onDoubleClick={() => props.navigation.keep(tab)}
      to={tab}
    >
      <span className={styles.path}>
        {folder ? <span className={styles.folder}>{folder}/</span> : null}
        <span className={styles.name}>{name}</span>
      </span>
      <DiffStat added={file.added} removed={file.removed} />
      <ChangeIcon change={file.change} label={label} />
    </FilesLink>
  )
}

/**
 * The files that the branch changes against the default branch, under the
 * totals of the whole change. A row is a link to the diff of its file, and
 * the row of the open diff is marked. A double-click on a row keeps the tab
 * that the row opens. A row shows the label of its path, and its real path
 * stays its key and its target.
 */
export function ChangeList(props: {
  changes: ChangesResponse
  openPath: string | null
  navigation: FilesNavigation
}) {
  const { summary } = props.changes
  return (
    <>
      <div className={styles.summary}>
        <span className={styles.count}>
          {summary.files} {summary.files === 1 ? 'file' : 'files'} changed
        </span>
        <DiffStat added={summary.added} removed={summary.removed} />
      </div>
      <div className={styles.scroll}>
        <ul aria-label="Changed files" className={styles.list}>
          {props.changes.files.map((file) => (
            <li key={file.path}>
              <Row
                file={file}
                navigation={props.navigation}
                open={file.path === props.openPath}
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
