import type { Workspace } from '../../shared/generated/Workspace'

import type { MenuAnchor } from '../ui/menu-place'

/** The menu keys open the menu of a row this far below it, as the mockups draw it. */
export const belowRow = 4

/** How a menu of a row opened, and where the focus goes when it closes. */
export interface MenuOpening {
  anchor: MenuAnchor
  /** Gives the focus back to the row, also after a render replaced it. */
  back: () => void
}

/** The field of Rename in a row, while it is open. */
export interface RowRename {
  /** Saves the trimmed name. It says whether the save worked. */
  save: (name: string) => Promise<boolean>
  cancel: () => void
}

/**
 * What a row needs from the menu of its list, when the person can use one
 * of its actions. A right click or the menu keys open it: a row has no
 * button for it.
 */
export interface RowMenu {
  /** The menu of this row is open. */
  open: boolean
  show: (opening: MenuOpening) => void
  /** The field of Rename, while it is open. */
  rename: RowRename | null
  /**
   * Opens the field of Rename, as a double click on the row does. It is
   * null when the menu of the row does not offer Rename.
   */
  startRename: (() => void) | null
}

/** The menus of the rows of a list. */
export type RowMenus = (workspace: Workspace) => RowMenu | undefined
