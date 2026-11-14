import type { Workspace } from '../../shared/generated/Workspace'
import { useToast } from '@firna/ui/toast'
import { errorMessage } from '../../app/api/client'
import type { ArchiveAction } from '../../app/archive-model'
import { mayRestore } from '../../app/permissions'
import { useServices } from '../../app/services'
import { useStore } from '../../app/store'
import type { User } from '../../shared/api'
import { nameLabel } from '../../shared/name-label'

import { useApp, useOrgModel } from '../context'
import { shownWorkspaces } from './tab-memory'

/** Archive and Restore of the workspaces of one org, for its controls. */
export interface ArchiveActions {
  archive: (workspace: Workspace) => void
  restore: (workspace: Workspace) => void
  /** The Archive or the Restore of a workspace that runs, if any. */
  running: (workspaceId: string) => ArchiveAction | null
}

/**
 * Archive and Restore from each control of the app: the row and its menu,
 * the pull request bar, the palette, the archived bar, and the toast. Each
 * control uses the one flow of its workspace, so a second press while it
 * runs sends nothing. Archive asks no question, and it shows as done at
 * once: the row moves to the Archived group, and the open workspace shows
 * as archived. A failed Archive brings both back. A done Archive shows a
 * toast that names the workspace. The toast offers Restore only while the
 * workspace can come back: it is still archived, its cloud computer is
 * kept, its last day of Restore has not passed, and the org is not
 * suspended. A failure shows a toast that names the workspace, with the
 * message of the server. Nothing here opens a workspace or starts its cloud
 * computer.
 */
export function useArchiveActions(orgId: string, viewer: User): ArchiveActions {
  const app = useApp()
  const services = useServices()
  const { toast } = useToast()
  const org = useOrgModel(orgId)
  const running = useStore(org.workspaceActions.running)
  const flowOf = (workspace: Workspace) =>
    shownWorkspaces(app, viewer).archive({
      orgId: workspace.orgId,
      workspaceId: workspace.id,
    })
  const failed = (workspace: Workspace, what: string) => (error: unknown) => {
    toast({
      title: `${nameLabel(workspace.name)} wasn't ${what}.`,
      description: errorMessage(error),
      tone: 'error',
    })
  }
  /** Whether the workspace can come back now, from its newest record. */
  const restorable = (archived: Workspace) => {
    const current = org.workspace(archived.id) ?? archived
    const ended =
      current.restoreUntil !== null && services.now() >= current.restoreUntil
    const suspended = org.suspension.suspended.get()
    return mayRestore({ suspended }, current, ended)
  }
  const restore = (workspace: Workspace) => {
    flowOf(workspace).restore().catch(failed(workspace, 'restored'))
  }
  const archive = (workspace: Workspace) => {
    flowOf(workspace)
      .archive()
      .then(
        (archived) => {
          if (!archived) return
          toast({
            title: `${nameLabel(workspace.name)} is archived.`,
            tone: 'success',
            action: restorable(archived)
              ? { label: 'Restore', onPress: () => restore(archived) }
              : undefined,
          })
        },
        failed(workspace, 'archived'),
      )
  }
  return {
    archive,
    restore,
    running: (workspaceId) => running.get(workspaceId)?.action ?? null,
  }
}
