import type { Workspace } from '../../shared/generated/Workspace'
import { Fragment, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import styles from '../../../docs/mockups/src/components/workspaces/SectionList.module.css'
import type { ArchiveAction } from '../../app/archive-model'
import { stepTarget, type SectionGroup } from '../../app/sections'
import { workspaceRowMove } from '../../app/shortcuts/navigation'

import { nameLabel } from '../../shared/name-label'
import ui from '../ui/ui.module.css'
import { ArchivedGroup, useArchivedOpen } from './ArchivedGroup'
import type { DropTarget } from './drop-target'
import { useListKeys } from './list-keys'
import type { RowMenus } from './row-menu'
import { LiftedSection, SectionDropLine } from './SectionDrag'
import { SectionHeader, type SectionActions } from './SectionHeader'
import { useRowDrag, type RowDragState } from './useRowDrag'
import { useSectionDrag } from './useSectionDrag'
import { useRowFocus } from './useRowFocus'
import { WorkspaceRow, type RowVariant } from './WorkspaceRow'
import list from './list.module.css'

/** The line where a dragged workspace lands. It marks a place, not an edge. */
function DropLine(props: { name: string; section: string }) {
  return (
    <li className={styles.drop}>
      <span aria-hidden className={styles.line}>
        <span className={styles.lineEnd} />
      </span>
      <span className={ui.hidden} role="status">
        Moving {props.name} to {props.section}
      </span>
    </li>
  )
}

/** The lifted row under the pointer. It takes no pointer input. */
function LiftedRow(props: {
  drag: RowDragState
  variant: RowVariant
  now: number
}) {
  const { drag } = props
  return createPortal(
    <div
      className={list.lifted}
      style={{
        left: drag.x - drag.offsetX,
        top: drag.y - drag.offsetY,
        width: drag.box.width,
      }}
    >
      <WorkspaceRow
        drag="lifted"
        now={props.now}
        selected={false}
        variant={props.variant}
        workspace={drag.item}
      />
    </div>,
    document.body,
  )
}

/**
 * The sections of the org, each a group of workspaces that the people of
 * the org made, then the Archived group. A workspace moves to another
 * section by drag and drop, by a long press on a phone, or by Alt with Up
 * or Down and no other modifier. A key with more modifiers, such as ⌥⌘↑,
 * stays free for its shortcut. A section moves to another place by a drag
 * of its name, or by the move items of its menu. `menus` gives each row its menu,
 * `archiveAction` its Archive shortcut, and `restoreAction` the Restore
 * shortcut of an archived row. `running` names the Archive or the Restore
 * of a row that runs, which its shortcut shows busy. A read-only list, as
 * in a suspended org, moves nothing and shows no section menu. While the
 * page shows the list, the keys of the workspaces open its rows, as
 * `useListKeys` says.
 */
export function SectionList(props: {
  groups: readonly SectionGroup[]
  archived: readonly Workspace[]
  variant: RowVariant
  selectedId: string | null
  now: number
  actions: SectionActions
  archiveAction?: (workspace: Workspace) => (() => void) | undefined
  restoreAction?: (workspace: Workspace) => (() => void) | undefined
  running?: (workspaceId: string) => ArchiveAction | null
  move: (workspaceId: string, target: DropTarget) => void
  readOnly: boolean
  /** The page shows this list, so it takes the keys of the workspaces. */
  offersKeys?: boolean
  menus?: RowMenus
}) {
  const [archived, setArchived] = useArchivedOpen(
    props.groups,
    props.archived,
    props.selectedId,
  )
  useListKeys({
    shown: [
      ...props.groups.flatMap((group) =>
        group.section.collapsed ? [] : group.workspaces,
      ),
      ...(archived ? props.archived : []),
    ],
    selectedId: props.selectedId,
    offered: props.offersKeys ?? false,
  })
  const { drag, bind, layout } = useRowDrag(props.move)
  /** A move by keys keeps the focus on its row. */
  const rows = useRowFocus()
  /** What a move by keys or by a menu says to a screen reader. */
  const [announcement, setAnnouncement] = useState('')
  const actions: SectionActions = {
    ...props.actions,
    moveTo: (section, index) => {
      setAnnouncement(`${section.name} moves to place ${index + 1}.`)
      props.actions.moveTo(section, index)
    },
  }
  const sections = useSectionDrag(layout, actions.moveTo)
  const lifted = props.groups.find(
    (group) => group.section.id === sections.drag?.item.id,
  )
  /** The sections without the dragged one, where its drop line counts. */
  const others = props.groups.filter((group) => group !== lifted)
  const sectionLine = (index: number) =>
    lifted && sections.drag?.place === index ? (
      <SectionDropLine name={lifted.section.name} place={index + 1} />
    ) : null
  const onKeyDown = (
    workspace: Workspace,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    const move = workspaceRowMove(event.nativeEvent)
    if (move === null) return
    event.preventDefault()
    const target = stepTarget(
      props.groups,
      workspace.id,
      move === 'up' ? -1 : 1,
    )
    if (!target) return
    const section = props.groups.find(
      (group) => group.section.id === target.sectionId,
    )
    setAnnouncement(
      `${nameLabel(workspace.name)} moves to ${section?.section.name ?? 'another section'}, place ${target.index + 1}.`,
    )
    props.move(workspace.id, target)
  }
  return (
    <div className={styles.sections}>
      <span className={ui.hidden} role="status">
        {announcement}
      </span>
      {props.groups.map((group, position) => {
        const { section, workspaces } = group
        const target = drag?.place.sectionId === section.id ? drag.place : null
        const rest = workspaces.filter((item) => item.id !== drag?.item.id)
        const line = drag ? (
          <DropLine name={nameLabel(drag.item.name)} section={section.name} />
        ) : null
        return (
          <Fragment key={section.id}>
            {group === lifted ? null : sectionLine(others.indexOf(group))}
            <section
              aria-label={section.name}
              className={classes(
                styles.section,
                group === lifted && styles.faint,
              )}
              ref={layout.section(section.id)}
            >
              <SectionHeader
                actions={actions}
                bind={
                  props.readOnly ? undefined : sections.bind(section, position)
                }
                count={workspaces.length}
                place={{ index: position, total: props.groups.length }}
                readOnly={props.readOnly}
                section={section}
                variant={props.variant}
              />
              {section.collapsed ? null : (
                <ul className={styles.rows}>
                  {workspaces.map((workspace, index) => (
                    <Fragment key={workspace.id}>
                      {target && rest[target.index]?.id === workspace.id
                        ? line
                        : null}
                      <li>
                        <WorkspaceRow
                          bind={
                            props.readOnly
                              ? undefined
                              : bind(workspace, {
                                  sectionId: section.id,
                                  index,
                                })
                          }
                          drag={
                            drag?.item.id === workspace.id
                              ? 'placeholder'
                              : undefined
                          }
                          focusRow={() => rows.focusLink(workspace.id)}
                          linkRef={rows.linkRef(workspace.id)}
                          menu={props.menus?.(workspace)}
                          now={props.now}
                          onArchive={props.archiveAction?.(workspace)}
                          acting={
                            (props.running?.(workspace.id) ?? null) !== null
                          }
                          onKeyDown={
                            props.readOnly
                              ? undefined
                              : (event) => onKeyDown(workspace, event)
                          }
                          onBlur={rows.blur}
                          onFocus={(event) => rows.focus(workspace.id, event)}
                          rowRef={layout.row(workspace.id, section.id)}
                          selected={workspace.id === props.selectedId}
                          variant={props.variant}
                          workspace={workspace}
                        />
                      </li>
                    </Fragment>
                  ))}
                  {target && target.index >= rest.length ? line : null}
                  {workspaces.length === 0 && !target ? (
                    <li className={styles.empty}>
                      New workspaces appear here.
                    </li>
                  ) : null}
                </ul>
              )}
            </section>
          </Fragment>
        )
      })}
      {sectionLine(others.length)}
      {props.archived.length > 0 ? (
        <ArchivedGroup
          menus={props.menus}
          now={props.now}
          onToggle={setArchived}
          open={archived}
          restoreAction={props.restoreAction}
          rows={props.archived}
          running={props.running}
          selectedId={props.selectedId}
          variant={props.variant}
        />
      ) : null}
      {drag ? (
        <LiftedRow drag={drag} now={props.now} variant={props.variant} />
      ) : null}
      {sections.drag && lifted ? (
        <LiftedSection count={lifted.workspaces.length} drag={sections.drag} />
      ) : null}
    </div>
  )
}
