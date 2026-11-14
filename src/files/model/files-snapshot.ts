import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import type { FilesError } from '../api/files-errors'
import type { FailedRepairs } from './failed-repairs'
import type { FileTree } from './tree-model'

/** What the screens read from the files store of one workspace. */
export interface FilesSnapshot {
  tree: FileTree | null
  /** Why the tree did not load, while no tree shows. */
  treeError: FilesError | null
  /**
   * The cloud computer could not read the files. `tree` is the saved tree,
   * or empty when none was saved. Only a full tree of the stream clears it.
   */
  treeUnavailable: boolean
  changes: ChangesResponse | null
  changesError: FilesError | null
  /** The folders that the user opened or closed in this page session. */
  folders: ReadonlyMap<string, boolean>
  /** Grows when affected paths cannot be named, including tree replacement. */
  epoch: number
  /** Grows for each path whose content an event may have changed. */
  versions: ReadonlyMap<string, number>
  /**
   * The file lists whose fresh full report was lost too. Only a newer full
   * report of the same list in the stream clears one.
   */
  failedRepairs: FailedRepairs
  /**
   * The folder that a press on its chip showed last, so All files scrolls
   * to it. `count` grows with each press, also on the same folder.
   */
  revealed: { path: string; count: number } | null
  /**
   * The label of each real path from the last file or diff read of it in
   * this page session, so a tab can name a file that no list names.
   */
  readLabels: ReadonlyMap<string, string>
}
