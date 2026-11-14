import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import { workspacePaths } from '../shared/workspaces'
import { ignore } from './api/parse'
import type { OrgModel } from './org-model'

const activityInterval = 60_000

/** Counts input in a running workspace at most once a minute. */
export class WorkspaceActivity {
  private lastActivity = Number.NEGATIVE_INFINITY
  private readonly org: OrgModel
  private readonly workspaceId: string

  constructor(org: OrgModel, workspaceId: string) {
    this.org = org
    this.workspaceId = workspaceId
  }

  report(state: WorkspaceState | undefined): void {
    if (this.org.suspension.suspended.get()) return
    if (state === undefined || state === 'stopped' || state === 'error') return
    if (state === 'archived') return
    const now = this.org.services.now()
    if (now - this.lastActivity < activityInterval) return
    this.lastActivity = now
    void this.org.services.api
      .send(
        'POST',
        workspacePaths.activity(this.org.orgId, this.workspaceId),
        { source: 'input' },
        ignore,
      )
      .catch(() => {
        this.lastActivity = Number.NEGATIVE_INFINITY
      })
  }
}
