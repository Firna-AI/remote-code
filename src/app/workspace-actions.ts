import type { Workspace } from '../shared/generated/Workspace'
import { workspacePath } from '../shared/workspaces'
import { readWorkspaceResponse } from './api/read-workspaces'
import { ArchiveModel, type ArchiveAction } from './archive-model'
import type { RunningWrite } from './archive-overlay'
import {
  workspaceLifecycle,
  workspaceReassigned,
  workspaceRenamed,
} from './list-changes'
import type { OrgModel } from './org-model'
import { same } from './resource'
import { Store } from './store'

/** The writes of workspace rows, without opening their workspaces. */
export class WorkspaceActions {
  /**
   * The Archive or the Restore that runs for each workspace of the org, and
   * when it started. The list and the open workspace show a running Archive
   * as done. The controls of a running Restore show it busy. Another write
   * of the workspace waits for its end.
   */
  readonly running = new Store<ReadonlyMap<string, RunningWrite>>(new Map())
  private readonly org: OrgModel
  private readonly archives = new Map<string, ArchiveModel>()

  constructor(org: OrgModel) {
    this.org = org
  }

  async rename(workspaceId: string, name: string): Promise<Workspace> {
    const detail = await this.org.resources.list.write(
      same,
      () =>
        this.org.services.api.send(
          'PATCH',
          workspacePath(this.org.orgId, workspaceId),
          { name },
          readWorkspaceResponse,
        ),
      ({ workspace }) => workspaceRenamed(workspace.id, workspace.name),
    )
    return detail.workspace
  }

  /** Confirms only the owner of the members API's reply. */
  reassigned(workspace: Workspace): void {
    this.org.resources.list.confirm(
      workspaceReassigned(workspace.id, workspace.owner),
      `workspace owner ${workspace.id}`,
    )
  }

  /**
   * Confirms the state of an Archive or a Restore reply, without replacing
   * newer fields or a newer Archive or Restore.
   */
  lifecycleChanged(workspace: Workspace): void {
    this.org.resources.list.confirm(
      workspaceLifecycle(workspace),
      `workspace lifecycle ${workspace.id}`,
    )
  }

  /** Marks the Archive or the Restore of a workspace that runs, or its end. */
  setRunning(workspaceId: string, action: ArchiveAction | null): void {
    const next = new Map(this.running.get())
    if (action) next.set(workspaceId, { action, at: this.org.services.now() })
    else next.delete(workspaceId)
    this.running.set(next)
  }

  /** Archive and Restore of a row that has no kept workspace model. */
  archive(workspaceId: string): ArchiveModel {
    let archive = this.archives.get(workspaceId)
    if (!archive) {
      archive = new ArchiveModel(this.org, workspaceId, (detail) =>
        this.lifecycleChanged(detail.workspace),
      )
      this.archives.set(workspaceId, archive)
    }
    return archive
  }
}
