import type { Workspace } from '../../shared/generated/Workspace'
import {
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { classes } from '../../../docs/mockups/src/components/common/classes'
import { WorkspaceMark } from '../../../docs/mockups/src/components/workspaces/WorkspaceMark'
import styles from '../../../docs/mockups/src/components/workspaces/WorkspaceRow.module.css'
import {
  activityPresentation,
  listMarkLabel,
} from '../../../docs/mockups/src/components/workspaces/status'
import { routes } from '../../app/router'
import { ownPress } from '../../app/pointer-drag'
import { formatAgo } from '../../app/time'
import { nameLabel } from '../../shared/name-label'

import { useApp } from '../context'
import { AppLink, isPlainClick } from '../ui/AppLink'
import { IconButton } from '../ui/actions'
import { opensMenu } from '../ui/menu-keys'
import ui from '../ui/ui.module.css'
import { belowRow, type RowMenu } from './row-menu'
import { WorkspaceNameField } from './WorkspaceNameField'
import list from './list.module.css'

export type RowVariant = 'sidebar' | 'page'

/** How a drag shows a row: under the pointer, or faint where it was. */
export type RowDrag = 'lifted' | 'placeholder'

function RowContent(props: { workspace: Workspace; now: number }) {
  const { workspace } = props
  return (
    <>
      <WorkspaceMark github={workspace.github} status={workspace.state} />
      <span className={styles.name}>{nameLabel(workspace.name)}</span>
      <span className={styles.time}>
        {formatAgo(props.now, workspace.updatedAt)}
      </span>
      <span className={ui.hidden}>
        , {listMarkLabel(workspace.github, workspace.state)}
      </span>
    </>
  )
}

/** Gives the element to a ref of its owner. */
function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

/**
 * One workspace on one line: its list mark, its name, or Untitled before it
 * has one, and the time since its last activity. The mark shows the GitHub
 * state of its pull request in colour, and whether its agent works. Bold
 * alone marks unread output. Its shortcut, Archive or Restore on an
 * archived row, covers the time on hover only, and stays while it runs. A
 * drag lifts the row, and a faint copy stays where it was. With `menu`, a
 * right click or the menu keys open the menu of the row, which keeps the
 * fill of a hover while it is open. The row has no button for the menu. The
 * field of Rename takes the place of the name and the time. Rename in the
 * menu opens it, and so does a plain double click on a row whose menu
 * offers Rename. A plain click on a row of the sidebar asks the message
 * field of the workspace to take the focus when its chat shows, so the
 * person can type at once. The second click of a double click does not
 * open the workspace again.
 */
export function WorkspaceRow({
  rowRef,
  linkRef,
  ...props
}: {
  workspace: Workspace
  variant: RowVariant
  selected: boolean
  now: number
  drag?: RowDrag
  /** The pointer handlers of a drag, and the keys that move the row. */
  bind?: HTMLAttributes<HTMLElement>
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  onArchive?: () => void
  /** Restore of an archived row, in the place of Archive. */
  onRestore?: () => void
  /** The Archive or the Restore of the row runs. */
  acting?: boolean
  /** The row's box, which a drag measures. */
  rowRef?: Ref<HTMLSpanElement>
  /** The row's link, which keeps the focus after a move by keys. */
  linkRef?: Ref<HTMLAnchorElement>
  /** A control in the row takes the focus, or loses it. */
  onFocus?: (event: FocusEvent<HTMLSpanElement>) => void
  onBlur?: (event: FocusEvent<HTMLSpanElement>) => void
  /** The menu of the row, when the person can use one of its actions. */
  menu?: RowMenu
  /**
   * Gives the focus to the current link of the row of this workspace, also
   * after a render replaced the row. It says whether it found the link.
   * Without it, or without such a link, the link of this row takes the
   * focus.
   */
  focusRow?: () => boolean
}) {
  const { workspace, menu } = props
  const app = useApp()
  const link = useRef<HTMLAnchorElement | null>(null)
  const renaming = menu?.rename ?? null
  // A field that closes with the focus in it gives the focus to the link.
  const wasRenaming = useRef(false)
  useLayoutEffect(() => {
    const closed = wasRenaming.current && renaming === null
    wasRenaming.current = renaming !== null
    const active = document.activeElement
    if (closed && (active === null || active === document.body)) {
      link.current?.focus()
    }
  }, [renaming])
  const page = props.variant === 'page'
  const className = classes(
    styles.row,
    page && styles.page,
    props.selected && styles.selected,
    styles[activityPresentation[workspace.state].emphasis],
    props.drag && styles[props.drag],
  )
  if (props.drag === 'lifted') {
    return (
      <div className={className}>
        <RowContent now={props.now} workspace={workspace} />
      </div>
    )
  }
  if (renaming) {
    return (
      <span
        className={classes(
          styles.row,
          page && styles.page,
          props.selected && styles.selected,
        )}
      >
        <WorkspaceMark github={workspace.github} status={workspace.state} />
        <WorkspaceNameField
          name={workspace.name}
          page={page}
          rename={renaming}
        />
      </span>
    )
  }
  const back = () => {
    if (!props.focusRow?.()) link.current?.focus()
  }
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    props.bind?.onContextMenu?.(event)
    // The drag stops the event while a finger holds the row for a drag.
    if (!menu || event.defaultPrevented) return
    event.preventDefault()
    // A browser can also send this event after the keys that open the menu.
    if (menu.open) return
    menu.show({ anchor: { x: event.clientX, y: event.clientY }, back })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (menu && opensMenu(event)) {
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      menu.show({ anchor: { x: box.left, y: box.bottom + belowRow }, back })
      return
    }
    props.onKeyDown?.(event)
  }
  // A click in the sidebar opens the workspace ready for a message.
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // The first click of a double click already opened the workspace, so a
    // second click adds no second entry to the history.
    if (event.detail > 1 && isPlainClick(event)) {
      event.preventDefault()
      return
    }
    if (page || event.defaultPrevented || !isPlainClick(event)) return
    app.composerFocus.set({
      workspaceId: workspace.id,
      from: event.currentTarget,
    })
  }
  const onDoubleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!menu?.startRename || !isPlainClick(event)) return
    event.preventDefault()
    menu.startRename()
  }
  const archived = workspace.state === 'archived'
  const action = props.drag
    ? undefined
    : archived
      ? props.onRestore
      : props.onArchive
  return (
    <span
      {...props.bind}
      className={classes(
        list.dragSurface,
        styles.container,
        action && styles.archivable,
        action && props.acting && styles.acting,
        menu?.open && styles.held,
      )}
      onBlur={props.onBlur}
      onContextMenu={onContextMenu}
      onFocus={props.onFocus}
      onKeyDown={onKeyDown}
      ref={rowRef}
    >
      <AppLink
        aria-current={props.selected ? 'page' : undefined}
        className={className}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        ref={(node) => {
          link.current = node
          setRef(linkRef, node)
        }}
        to={routes.workspace(workspace.orgId, workspace.id)}
      >
        <RowContent now={props.now} workspace={workspace} />
      </AppLink>
      {action ? (
        <span {...ownPress} className={styles.archive}>
          <IconButton
            busy={props.acting}
            icon={archived ? ArchiveRestore : Archive}
            label={archived ? 'Restore workspace' : 'Archive workspace'}
            onPress={action}
            quiet
          />
        </span>
      ) : null}
    </span>
  )
}
