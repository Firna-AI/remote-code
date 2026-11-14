import type { Workspace } from '../shared/generated/Workspace'
import { workspacePaths, type WorkspaceResponse } from '../shared/workspaces'
import { readWorkspaceResponse } from './api/read-workspaces'
import type { OrgModel } from './org-model'

/** The write of a workspace that ends it or brings it back. */
export type ArchiveAction = 'archive' | 'restore'

/**
 * Archive and Restore of one workspace. Archive stops its cloud computer at
 * once, with no check and no question. Restore puts it back in its
 * section, stopped, and starts nothing. Each sends one request, and
 * `changed` takes its reply. One write of the workspace runs at a time,
 * over every model of the org: a press while one runs sends nothing and
 * gives null. `WorkspaceActions.running` holds the write that runs, and
 * the list and the open workspace show a running Archive as done. A
 * failed write throws to its caller, which names the failure, and its end
 * takes the shown Archive back.
 */
export class ArchiveModel {
  private readonly org: OrgModel
  private readonly workspaceId: string
  private readonly changed: (detail: WorkspaceResponse) => void

  constructor(
    org: OrgModel,
    workspaceId: string,
    changed: (detail: WorkspaceResponse) => void,
  ) {
    this.org = org
    this.workspaceId = workspaceId
    this.changed = changed
  }

  archive(): Promise<Workspace | null> {
    return this.send('archive')
  }

  restore(): Promise<Workspace | null> {
    return this.send('restore')
  }

  private async send(action: ArchiveAction): Promise<Workspace | null> {
    const actions = this.org.workspaceActions
    if (actions.running.get().has(this.workspaceId)) return null
    actions.setRunning(this.workspaceId, action)
    try {
      const detail = await this.org.services.api.send(
        'POST',
        workspacePaths[action](this.org.orgId, this.workspaceId),
        {},
        readWorkspaceResponse,
      )
      this.changed(detail)
      return detail.workspace
    } finally {
      actions.setRunning(this.workspaceId, null)
    }
  }
}
