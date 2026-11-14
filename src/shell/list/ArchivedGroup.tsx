import type { Workspace } from '../../shared/generated/Workspace'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import styles from '../../../docs/mockups/src/components/workspaces/SectionList.module.css'
import type { ArchiveAction } from '../../app/archive-model'
import type { SectionGroup } from '../../app/sections'

import type { RowMenus } from './row-menu'
import { WorkspaceRow, type RowVariant } from './WorkspaceRow'

/**
 * Whether the Archived group shows its rows, and the toggle of the user. The
 * group is collapsed until the user opens it. A workspace that is archived
 * when it opens opens the group too, so that its row shows. A workspace that
 * the user archives while it is open leaves the group as it was, open or
 * collapsed. The list keeps the choice, because its keys count only the rows
 * that it shows.
 */
export function useArchivedOpen(
  groups: readonly SectionGroup[],
  rows: readonly Workspace[],
  selectedId: string | null,
): [boolean, (open: boolean) => void] {
  const [opened, setOpened] = useState<boolean | null>(null)
  const isLive = groups.some((group) =>
    group.workspaces.some((row) => row.id === selectedId),
  )
  /** The open workspace, while it stays open after the list showed it live. */
  const [held, setHeld] = useState<string | null>(isLive ? selectedId : null)
  const next = isLive || held === selectedId ? selectedId : null
  if (next !== held) setHeld(next)
  const shown = next === null && rows.some((row) => row.id === selectedId)
  return [opened ?? shown, setOpened]
}

/**
 * The archived workspaces at the end of the list. The group is the app's
 * own, not a section of the org, so it has no menu, and it is collapsed
 * until the user opens it, as `useArchivedOpen` says. An archived workspace
 * opens with its chat read-only. The menu of each row copies the link of
 * the workspace, and an admin's menu also reassigns it. `restoreAction` gives a row its Restore shortcut, which
 * covers its time on hover, as Archive does.
 */
export function ArchivedGroup(props: {
  rows: readonly Workspace[]
  variant: RowVariant
  selectedId: string | null
  now: number
  open: boolean
  onToggle: (open: boolean) => void
  menus?: RowMenus
  restoreAction?: (workspace: Workspace) => (() => void) | undefined
  /**
   * The write of a row that runs. Only a Restore shows busy: an Archive
   * that runs already shows its row here, as done.
   */
  running?: (workspaceId: string) => ArchiveAction | null
}) {
  const { open } = props
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section aria-label="Archived" className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          <button
            aria-expanded={open}
            className={styles.toggle}
            onClick={() => props.onToggle(!open)}
            type="button"
          >
            <Chevron aria-hidden className={styles.chevron} size={12} />
            <span className={styles.name}>Archived</span>
            {open ? null : (
              <span className={styles.count}>{props.rows.length}</span>
            )}
          </button>
        </h3>
      </div>
      {open ? (
        <ul className={styles.rows}>
          {props.rows.map((row) => (
            <li key={row.id}>
              <WorkspaceRow
                acting={props.running?.(row.id) === 'restore'}
                menu={props.menus?.(row)}
                now={props.now}
                onRestore={props.restoreAction?.(row)}
                selected={row.id === props.selectedId}
                variant={props.variant}
                workspace={row}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
