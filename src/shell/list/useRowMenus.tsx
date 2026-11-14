import type { Workspace } from '../../shared/generated/Workspace'
import { useState, type ReactNode } from 'react'
import { useToast } from '@firna/ui/toast'
import {
  workspaceMenuItems,
  type WorkspaceMenuItem,
} from '../../../docs/mockups/src/components/workspaces/workspaceMenu'
import { linkResults } from '../../../docs/mockups/src/components/workspace/linkCopy'
import { errorMessage } from '../../app/api/client'
import type { ArchiveAction } from '../../app/archive-model'
import { usePassedDeadlines } from '../../app/deadlines'
import { mayArchive, mayRestore } from '../../app/permissions'
import type { SectionGroup } from '../../app/sections'
import { useServices } from '../../app/services'
import { useStore } from '../../app/store'
import type { User } from '../../shared/api'

import { useApp, useOrgModel } from '../context'
import { useViewport } from '../ui/viewport'
import { shownWorkspaces } from '../workspace/tab-memory'
import { useArchiveActions } from '../workspace/useArchiveActions'
import type { DropTarget } from './drop-target'
import type { MenuOpening, RowMenus } from './row-menu'
import { RowMenu, type RowActions } from './RowMenu'

type OpenMenu = MenuOpening & { workspaceId: string }

/** The action of a row that runs at once, or none for the person. */
type RowAction = (workspace: Workspace) => (() => void) | undefined

const renames = (items: readonly WorkspaceMenuItem[]) =>
  items.some((item) => item.kind === 'action' && item.action === 'rename')

/**
 * The menus of the rows of a list, their Rename field, which a double click
 * on a row also opens, the Archive shortcut of each row, and the Restore
 * shortcut of each archived row. Each row gets only the actions that the
 * person can use. Every row offers Copy link, also an archived row and a
 * row of a read-only list, and a toast gives the result of its copy. A
 * change of the role, the workspace, or the org drops an action that it
 * takes away. The shortcut and Archive in the menu run the one
 * flow of the workspace, which archives at once and offers Restore in its
 * toast. Every member of an org that is not suspended restores an archived
 * row until its `restoreUntil`, and the shortcut ends at that time while
 * the list shows. Nothing here opens a workspace, starts its cloud
 * computer, or marks it as read.
 */
export function useRowMenus(props: {
  orgId: string
  viewer: User
  groups: readonly SectionGroup[]
  archived: readonly Workspace[]
  readOnly: boolean
  move: (workspaceId: string, target: DropTarget) => void
}): {
  menus: RowMenus
  archiveAction: RowAction
  restoreAction: RowAction
  running: (workspaceId: string) => ArchiveAction | null
  layer: ReactNode
} {
  const app = useApp()
  const services = useServices()
  const { toast } = useToast()
  const phone = useViewport() === 'phone'
  const org = useStore(app.orgs).find((item) => item.id === props.orgId)
  const suspended = useStore(useOrgModel(props.orgId).suspension.suspended)
  const memory = shownWorkspaces(app, props.viewer)
  const lifecycle = useArchiveActions(props.orgId, props.viewer)
  const passed = usePassedDeadlines(
    props.archived.map((row) => row.restoreUntil),
  )
  const [scope, setScope] = useState(props.orgId)
  const [open, setOpen] = useState<OpenMenu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { groups } = props
  // The menu and the field of another org close.
  if (scope !== props.orgId) {
    setScope(props.orgId)
    setOpen(null)
    setRenaming(null)
  }

  const rows = [
    ...groups.flatMap((group) => group.workspaces),
    ...props.archived,
  ]
  const find = (id: string) => rows.find((row) => row.id === id)
  const itemsOf = (workspace: Workspace): WorkspaceMenuItem[] =>
    workspaceMenuItems({
      admin: org?.role === 'admin',
      owner: workspace.owner.id === props.viewer.id,
      archived: workspace.state === 'archived',
      otherSection: groups.length > 1,
      // Without the org, the role is unknown, so the menu offers only the
      // action that changes nothing.
      readOnly: props.readOnly || !org,
    })
  const openRow = open ? find(open.workspaceId) : undefined
  const openItems = openRow ? itemsOf(openRow) : []
  if (open && openItems.length === 0) setOpen(null)
  const renamingRow = renaming ? find(renaming) : undefined
  if (renaming && !(renamingRow && renames(itemsOf(renamingRow)))) {
    setRenaming(null)
  }

  const archive = (workspace: Workspace) => lifecycle.archive(workspace)
  const archiveAction: RowAction = (workspace) => {
    if (!org || props.readOnly) return undefined
    const access = { role: org.role, suspended }
    if (!mayArchive(access, workspace, props.viewer)) return undefined
    return () => archive(workspace)
  }
  const restoreAction: RowAction = (workspace) => {
    if (!org || props.readOnly) return undefined
    const ended = passed(workspace.restoreUntil)
    if (!mayRestore({ suspended }, workspace, ended)) return undefined
    return () => lifecycle.restore(workspace)
  }
  const save = async (workspace: Workspace, name: string) => {
    const target = { orgId: workspace.orgId, workspaceId: workspace.id }
    try {
      await memory.rename(target, name)
    } catch (error) {
      toast({
        title: "The workspace wasn't renamed.",
        description: errorMessage(error),
        tone: 'error',
      })
      return false
    }
    setRenaming((current) => (current === workspace.id ? null : current))
    return true
  }
  const copyLink = (workspace: Workspace) => {
    services.copy(workspace.link).then(
      () => toast({ title: linkResults.copied, tone: 'success' }),
      () => toast({ title: linkResults.failed, tone: 'error' }),
    )
  }
  const actions: RowActions = {
    move: (workspace, sectionId) =>
      props.move(workspace.id, { sectionId, index: 0 }),
    rename: (workspace) => setRenaming(workspace.id),
    copyLink,
    archive,
    reassigned: (workspace) => memory.reassigned(workspace),
  }

  const menus: RowMenus = (workspace) => {
    const items = itemsOf(workspace)
    if (items.length === 0) return undefined
    return {
      open: open?.workspaceId === workspace.id,
      show: (opening) => setOpen({ ...opening, workspaceId: workspace.id }),
      rename:
        renaming === workspace.id && renames(items)
          ? {
              save: (name) => save(workspace, name),
              cancel: () => setRenaming(null),
            }
          : null,
      startRename: renames(items)
        ? () => {
            setOpen(null)
            setRenaming(workspace.id)
          }
        : null,
    }
  }
  const sectionOf = (id: string) =>
    groups.find((group) => group.workspaces.some((row) => row.id === id))
      ?.section.id ?? null
  const layer = (
    <>
      {open && openRow && openItems.length > 0 ? (
        <RowMenu
          actions={actions}
          close={() => setOpen(null)}
          items={openItems}
          key={open.workspaceId}
          opening={open}
          phone={phone}
          sectionId={sectionOf(open.workspaceId)}
          sections={groups.map((group) => group.section)}
          workspace={openRow}
        />
      ) : null}
    </>
  )
  return {
    menus,
    archiveAction,
    restoreAction,
    running: lifecycle.running,
    layer,
  }
}
