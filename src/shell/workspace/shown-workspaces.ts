import type { Workspace } from '../../shared/generated/Workspace'
import type { AppModel } from '../../app/app-model'
import type { ArchiveModel } from '../../app/archive-model'
import type { OrgModel } from '../../app/org-model'
import { valueOf } from '../../app/store'
import { WorkspaceModel } from '../../app/workspace-model'
import type { WorkspaceIdentity } from '../../app/workspace-store'
import { ChatController } from '../../chat/state/controller'
import type { ChatSources } from '../../chat/state/sources'
import type { SubscribeToWorkspace } from '../../chat/stream/workspace-stream'
import type { WorkspaceFiles } from '../../files/model/files-store'

import { createWorkspaceFiles } from './files/files-store'
import { HeaderNotices } from './header-notices'
import { ToolEvents } from './tools/tool-events'
import { WorkspaceView } from './workspace-view'

/**
 * A workspace that the tab showed: its model, the failed repairs under its
 * header, and its chat. The stream of the model and the stream of the chat
 * each keep their last event number while the tab shows another page.
 */
export interface ShownWorkspace {
  readonly model: WorkspaceModel
  readonly notices: HeaderNotices
  readonly chat: ChatController
  /** The events that the tools read, with the revokes that they keep. */
  readonly toolEvents: ToolEvents
}

interface KeptWorkspace extends ShownWorkspace {
  readonly org: OrgModel
  /** Whether a screen showed it, so that its first show read the members. */
  started: boolean
}

/**
 * The inputs of a kept chat from the app models that own them: the account,
 * the org, the models, the members, and the workspace list of the org. So a
 * login that the account screen saves, a new default model, or a rename of a
 * linked workspace shows in the kept chat at once. The chat watches the list
 * while it shows, as the sidebar does.
 */
function chatSources(app: AppModel, org: OrgModel): ChatSources {
  return {
    account: app.account.account,
    models: app.models,
    org: {
      get: () => app.orgs.get().find((item) => item.id === org.orgId) ?? null,
      subscribe: app.orgs.subscribe,
    },
    members: {
      get: () => valueOf(org.members.get()) ?? null,
      subscribe: org.members.subscribe,
    },
    workspaces: {
      get: () => valueOf(org.workspaces.get()) ?? null,
      subscribe: org.workspaces.subscribe,
    },
    watchWorkspaces: () => org.watch('list'),
  }
}

/**
 * The workspaces that one tab showed for one signed-in user. A return to a
 * workspace shows its header, its notices, and its chat at once, and each of
 * its streams asks only for the events after its own last event number. It
 * keeps nothing in browser storage, so a reload or a new tab starts empty.
 */
export class ShownWorkspaces {
  readonly userId: string
  private readonly app: AppModel
  private readonly onShow: () => boolean
  private readonly subscribe: SubscribeToWorkspace
  private readonly kept = new Map<string, KeptWorkspace>()
  /** The kept files of each workspace, made when a Files part first shows. */
  private readonly keptFiles = new Map<string, WorkspaceFiles>()

  /**
   * `onShow` runs at the first show of each workspace, after its render. It
   * says whether the tab still keeps this memory.
   */
  constructor(app: AppModel, userId: string, onShow: () => boolean) {
    this.app = app
    this.userId = userId
    this.onShow = onShow
    const { events } = app.services
    // The chat opens the event socket of the app, as the model does.
    this.subscribe = (target, afterEventNumber, listener) =>
      events.open({ ...target, afterEventNumber }, listener)
  }

  /**
   * A view of the kept parts of a workspace, for the `create` of
   * `useWorkspaceStore`. The first view makes the parts. It starts no read
   * and no subscription: the first connect of a view does.
   */
  view(workspace: WorkspaceIdentity): WorkspaceView {
    const key = `${workspace.orgId}/${workspace.workspaceId}`
    const shown = this.kept.get(key) ?? this.keep(key, workspace)
    return new WorkspaceView(shown, () => this.start(key, shown))
  }

  /** Saves a row's name and updates a model that the tab already keeps. */
  async rename(workspace: WorkspaceIdentity, name: string): Promise<void> {
    const { orgId, workspaceId } = workspace
    const updated = await this.app
      .org(orgId)
      .workspaceActions.rename(workspaceId, name)
    this.kept.get(`${orgId}/${workspaceId}`)?.model.renamed(updated)
  }

  /** Takes the owner reply without opening the workspace. */
  reassigned(workspace: Workspace): void {
    const kept = this.kept.get(`${workspace.orgId}/${workspace.id}`)
    if (kept) kept.model.reassigned(workspace)
    else this.app.org(workspace.orgId).workspaceActions.reassigned(workspace)
  }

  /** Reuses a kept Archive flow, or the flow of an unopened list row. */
  archive(workspace: WorkspaceIdentity): ArchiveModel {
    const { orgId, workspaceId } = workspace
    return (
      this.kept.get(`${orgId}/${workspaceId}`)?.model.archive ??
      this.app.org(orgId).workspaceActions.archive(workspaceId)
    )
  }

  private keep(key: string, workspace: WorkspaceIdentity): KeptWorkspace {
    const { orgId, workspaceId } = workspace
    const { services } = this.app
    const org = this.app.org(orgId)
    const shown: KeptWorkspace = {
      model: new WorkspaceModel(org, workspaceId),
      notices: new HeaderNotices(),
      toolEvents: new ToolEvents(),
      chat: new ChatController({
        target: { orgId, workspaceId },
        // The client of the org takes each `org_suspended` refusal of the
        // chat, so a page with an old org list turns read-only at once.
        client: org.services.api,
        subscribe: this.subscribe,
        newId: services.newId,
        sources: chatSources(this.app, org),
        readOnly: () => org.suspension.suspended.get(),
      }),
      org,
      started: false,
    }
    this.kept.set(key, shown)
    return shown
  }

  /**
   * The first show of a kept workspace. It says whether the tab still keeps
   * the workspace. Later shows start nothing more.
   */
  private start(key: string, shown: KeptWorkspace): boolean {
    if (this.kept.get(key) !== shown) return false
    if (shown.started) return true
    if (!this.onShow()) return false
    shown.started = true
    const { org } = shown
    // The chat names the members of the org. A first show reads them when
    // no screen did, and a return reads them never again.
    if (org.members.get().state !== 'ready') void org.reload('members')
    return true
  }

  /**
   * The kept files of a workspace. The first call makes the store, which
   * starts nothing. The Files part connects it while it shows, so a return
   * shows the lists at once and reads only the events after the last one.
   * It reads through the client of the org, which takes each
   * `org_suspended` refusal.
   */
  files(orgId: string, workspaceId: string): WorkspaceFiles {
    const key = `${orgId}/${workspaceId}`
    const known = this.keptFiles.get(key)
    if (known) return known
    const files = createWorkspaceFiles(this.app.org(orgId).services, {
      orgId,
      workspaceId,
    })
    this.keptFiles.set(key, files)
    return files
  }

  /** Stops every kept workspace and forgets it, as at a sign-out. */
  clear(): void {
    for (const shown of this.kept.values()) stop(shown)
    this.kept.clear()
    for (const files of this.keptFiles.values()) files.stop()
    this.keptFiles.clear()
  }
}

function stop(shown: KeptWorkspace): void {
  shown.model.close()
  shown.chat.stop()
}
