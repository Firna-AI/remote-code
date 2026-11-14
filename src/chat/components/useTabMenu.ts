import type { TranscriptDetail } from '../../shared/generated/TranscriptDetail'
import { useCallback, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  Copy,
  CopyPlus,
  Pencil,
} from 'lucide-react'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import { linkItem } from '../../../docs/mockups/src/components/workspace/linkCopy'
import { transcriptItems } from '../../../docs/mockups/src/components/workspace/transcriptCopy'
import styles from '../../../docs/mockups/src/components/workspace/WorkspaceTabs.module.css'
import { useLongPress } from '../../app/long-press'

import { opensMenu } from '../../shell/ui/menu-keys'
import type { MenuEntry, MenuPoint } from '../ui/Menu'
import { rowKey, type RowTab, type TabItemProps } from './tab-row'
import local from './tabs.module.css'

/** The open menu of a tab: its title, where it opens, and its items. */
export interface OpenTabMenu {
  title: string
  at: MenuPoint
  entries: MenuEntry[]
}

/** An item of the tab menu, and whether it changes the workspace. */
interface TabMenuItem {
  entry: Extract<MenuEntry, { kind: 'item' }>
  /**
   * The item changes the workspace, such as a rename or a move. A read-only
   * row leaves out each marked item, so an item that changes nothing, such
   * as a copy, shows there with no rule of its own.
   */
  changes: boolean
}

/** What the items of the tab menu do. */
interface TabMenuActions {
  onRename: (id: string) => void
  onStep: (tab: RowTab, by: -1 | 1) => void
  /** Keeps the temporary tab in its place, through the `keep` of its host. */
  onKeep: (tab: RowTab) => void
  /** Copies the transcript of a session, during the press of its item. */
  onCopy: (id: string, detail: TranscriptDetail) => void
  /**
   * Copies the link of a session, during the press of its item. Without
   * it, as before the workspace loads, the menu has no Copy link.
   */
  onCopyLink?: (id: string) => void
}

/** The menu opens this far below a tab, as the mockups draw it. */
const below = 4

/** The icon of each copy item, as the mockups draw it. */
const copyIcons: Readonly<Record<TranscriptDetail, LucideIcon>> = {
  concise: Copy,
  full: CopyPlus,
}

/**
 * The groups of items of the menu of the tab at `index` of the row. A
 * session tab has Rename session, Copy link and its two transcript copies,
 * and the moves. The temporary tab has Keep open and the moves, and a kept
 * file or diff tab has the moves. A move that the place of the tab rules
 * out is off.
 */
function groupsOf(
  tabs: readonly RowTab[],
  index: number,
  act: (action: () => void) => () => void,
  actions: TabMenuActions,
): TabMenuItem[][] {
  const tab = tabs[index]
  const moves: TabMenuItem[] = [
    {
      entry: {
        kind: 'item',
        key: 'move-left',
        label: 'Move left',
        icon: ArrowLeft,
        disabled: index === 0,
        onSelect: act(() => actions.onStep(tab, -1)),
      },
      changes: true,
    },
    {
      entry: {
        kind: 'item',
        key: 'move-right',
        label: 'Move right',
        icon: ArrowRight,
        disabled: index === tabs.length - 1,
        onSelect: act(() => actions.onStep(tab, 1)),
      },
      changes: true,
    },
  ]
  if (tab.kind === 'host') {
    if (tab.keep === null) return [moves]
    // The icon is a bookmark with a check, as the mockups draw it, because
    // a pin names the pinned tabs of a browser.
    const keep: TabMenuItem = {
      entry: {
        kind: 'item',
        key: 'keep-open',
        label: 'Keep open',
        icon: BookmarkCheck,
        onSelect: act(() => actions.onKeep(tab)),
      },
      changes: true,
    }
    return [[keep], moves]
  }
  const copy = (detail: TranscriptDetail): TabMenuItem => ({
    entry: {
      kind: 'item',
      key: `copy-${detail}`,
      label: transcriptItems[detail],
      icon: copyIcons[detail],
      onSelect: act(() => actions.onCopy(tab.id, detail)),
    },
    changes: false,
  })
  const { onCopyLink } = actions
  const link: TabMenuItem[] = onCopyLink
    ? [
        {
          entry: {
            kind: 'item',
            key: 'copy-link',
            ...linkItem,
            onSelect: act(() => onCopyLink(tab.id)),
          },
          changes: false,
        },
      ]
    : []
  const rename: TabMenuItem = {
    entry: {
      kind: 'item',
      key: 'rename',
      label: 'Rename session',
      icon: Pencil,
      onSelect: act(() => actions.onRename(tab.id)),
    },
    changes: true,
  }
  return [[rename], [...link, copy('concise'), copy('full')], moves]
}

/**
 * The entries of a menu: the items that the row allows, with a line between
 * two groups that keep an item. A read-only row leaves out each item that
 * changes the workspace.
 */
function entriesOf(
  groups: readonly (readonly TabMenuItem[])[],
  readOnly: boolean,
): MenuEntry[] {
  const entries: MenuEntry[] = []
  for (const group of groups) {
    const kept = group.filter((item) => !readOnly || !item.changes)
    if (kept.length === 0) continue
    if (entries.length > 0) entries.push({ kind: 'divider' })
    entries.push(...kept.map((item) => item.entry))
  }
  return entries
}

/**
 * The menu of each tab. A right click opens it at the pointer. Shift and
 * F10, or the Menu key, on a focused tab opens it below the tab, through the
 * key handler of the tab, on every system. `open` opens it after a long
 * press of a drag that ends with no move. A read-only row leaves out each
 * item that changes the workspace, so a session tab keeps only Copy link
 * and its transcript copies, and the temporary tab loses Keep open with its
 * moves. That row binds no drag, so a finger opens the menu with the long
 * press of `useLongPress`, which lifts no tab. A tab with no item, such as a
 * file tab of a read-only row, and a tab that shows its rename field open no
 * menu, so the browser shows its own.
 */
export function useTabMenu(
  props: {
    tabs: readonly RowTab[]
    readOnly: boolean
    renaming: string | null
  } & TabMenuActions,
) {
  const { tabs, readOnly } = props
  const [open, setOpen] = useState<{ key: string; at: MenuPoint } | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const show = useCallback(
    (key: string, at: MenuPoint) => setOpen({ key, at }),
    [],
  )
  const hold = useLongPress(show)
  const act = (action: () => void) => () => {
    close()
    action()
  }
  /** The entries of the menu of the tab at `index`, or none. */
  const entriesAt = (index: number): MenuEntry[] => {
    const tab = tabs[index]
    if (tab.kind === 'session' && tab.id === props.renaming) return []
    return entriesOf(groupsOf(tabs, index, act, props), readOnly)
  }
  const openIndex = open
    ? tabs.findIndex((tab) => rowKey(tab) === open.key)
    : -1
  const entries = openIndex >= 0 ? entriesAt(openIndex) : []
  // A tab that leaves the row, starts to rename, or keeps no item, such as a
  // file tab when the workspace turns read-only, closes its menu, so the menu
  // does not open again when the tab comes back.
  if (open && entries.length === 0) setOpen(null)
  const menu: OpenTabMenu | null =
    open && entries.length > 0
      ? { title: tabs[openIndex].title, at: open.at, entries }
      : null

  /** The props of the list item of the tab at `index`, over those of its drag. */
  const item = (
    tab: RowTab,
    index: number,
    base: TabItemProps,
  ): TabItemProps => {
    if (entriesAt(index).length === 0) return base
    const key = rowKey(tab)
    const held = readOnly ? hold(key) : null
    return {
      ...base,
      onPointerDown: held?.onPointerDown ?? base.onPointerDown,
      className: classes(
        base.className,
        held !== null && local.holdSurface,
        menu !== null && open?.key === key && styles.menuOpen,
      ),
      onContextMenu: (event) => {
        base.onContextMenu?.(event)
        held?.onContextMenu?.(event)
        // A drag or a hold stops the event while a finger holds the tab,
        // whose release opens the menu.
        if (event.defaultPrevented) return
        event.preventDefault()
        // A browser can also send this event after the keys that open it.
        if (open?.key !== key) show(key, { x: event.clientX, y: event.clientY })
      },
      onKeyDown: (event) => {
        base.onKeyDown?.(event)
        if (!opensMenu(event)) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        show(key, { x: box.left, y: box.bottom + below })
      },
    }
  }

  return { menu, item, open: show, close }
}
