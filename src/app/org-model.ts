import type { Workspace } from '../shared/generated/Workspace'
import type { GitHubCapabilities } from '../shared/github'
import { membersPath, type MembersResponse } from '../shared/members'
import {
  orgSettingsPaths,
  type BuildsResponse,
  type ImageBuild,
  type OrgSettings,
  type Repository,
} from '../shared/org-settings'
import { routinesPath } from '../shared/routines'
import { sectionsPath, type Section } from '../shared/sections'
import { workspacesPath } from '../shared/workspaces'
import { items, record } from './api/parse'
import { readSection } from './api/read-core'
import { readRoutines, type ListedRoutine } from './api/read-routines'
import { readWorkspaces } from './api/read-workspaces'
import {
  readBuildResponse,
  readBuilds,
  readMembers,
  readRepositories,
  readSettings,
} from './api/read-settings'
import { listWithArchives } from './archive-overlay'
import { Creations } from './creations'
import { workspaceUpdated, type ListData } from './list-changes'
import { NewWorkspaceModel } from './new-workspace-model'
import { buildsWait, listWait, onEntry, routinesWait } from './org-waits'
import { Refresher, type Refreshing } from './refresh'
import { Resource } from './resource'
import type { AppServices } from './services'
import { derived, partOf, valueOf, type Loadable, type Readable } from './store'
import { WorkspaceActions } from './workspace-actions'
import {
  neverSuspended,
  noteOrgRefusals,
  type OrgSuspension,
} from './suspension'

export type OrgPart =
  'list' | 'repositories' | 'builds' | 'members' | 'routines'

/**
 * The data of one org: its list of sections and workspaces, its
 * repositories, the builds and settings of its cloud computer, its
 * members, and its routines. A part reads while a screen shows it, as
 * `watch` says. The Cloud computer tab reads the settings itself. Each
 * request of the org that the API refuses with `org_suspended` goes to
 * `suspension`, so a page with an old org list learns of the suspension.
 */
export class OrgModel {
  readonly orgId: string
  readonly services: AppServices
  readonly suspension: OrgSuspension
  readonly resources: {
    readonly list: Resource<ListData>
    readonly repositories: Resource<readonly Repository[]>
    readonly builds: Resource<BuildsResponse>
    readonly members: Resource<MembersResponse>
    readonly routines: Resource<readonly ListedRoutine[]>
    /**
     * The settings of the cloud computer. Every opening of the Cloud
     * computer tab shares them, so a save from a closed tab still shows.
     */
    readonly settings: Resource<OrgSettings>
  }
  readonly sections: Readable<Loadable<readonly Section[]>>
  /**
   * The workspaces as screens show them: each Archive that runs shows as
   * done, so it feels instant. A failed Archive shows the row as before.
   */
  readonly workspaces: Readable<Loadable<readonly Workspace[]>>
  /**
   * The workspaces as the server confirmed them, without the Archives that
   * wait for their reply. The detail of the open workspace follows them, so
   * its order never takes a record that a failed Archive takes back.
   */
  readonly confirmedWorkspaces: Readable<Loadable<readonly Workspace[]>>
  readonly repositories: Readable<Loadable<readonly Repository[]>>
  readonly builds: Readable<Loadable<BuildsResponse>>
  readonly members: Readable<Loadable<MembersResponse>>
  readonly routines: Readable<Loadable<readonly ListedRoutine[]>>
  /** The create requests of this tab, which a sign-out ends. */
  readonly creations = new Creations()
  /** The GitHub access of the signed-in member, by repository ID. */
  private readonly githubAccess = new Map<string, GitHubCapabilities>()
  readonly workspaceActions: WorkspaceActions
  private readonly parts: Readonly<Record<OrgPart, Refreshing>>
  private readonly drafts = new Map<string, NewWorkspaceModel>()

  constructor(
    services: AppServices,
    orgId: string,
    suspension: OrgSuspension = neverSuspended,
  ) {
    this.suspension = suspension
    const api = noteOrgRefusals(services.api, () => suspension.note())
    this.services = { ...services, api }
    this.orgId = orgId
    this.resources = {
      list: new Resource<ListData>(async () => {
        const [sections, workspaces] = await Promise.all([
          api.get(sectionsPath(orgId), (body) =>
            items(record(body), 'sections', readSection),
          ),
          api.get(workspacesPath(orgId), readWorkspaces),
        ])
        return { sections, workspaces }
      }),
      repositories: new Resource<readonly Repository[]>(() =>
        api.get(orgSettingsPaths.repositories(orgId), readRepositories),
      ),
      builds: new Resource<BuildsResponse>(() =>
        api.get(orgSettingsPaths.builds(orgId), readBuilds),
      ),
      members: new Resource<MembersResponse>(() =>
        api.get(membersPath(orgId), readMembers),
      ),
      routines: new Resource<readonly ListedRoutine[]>(() =>
        api.get(routinesPath(orgId), readRoutines),
      ),
      settings: new Resource<OrgSettings>(() =>
        api.get(orgSettingsPaths.settings(orgId), readSettings),
      ),
    }
    const { list, repositories, builds, members, routines } = this.resources
    this.workspaceActions = new WorkspaceActions(this)
    this.sections = partOf(list.store, (value) => value.sections)
    this.confirmedWorkspaces = partOf(list.store, (value) => value.workspaces)
    this.workspaces = derived(
      this.confirmedWorkspaces,
      this.workspaceActions.running,
      listWithArchives,
    )
    this.repositories = repositories.store
    this.builds = builds.store
    this.members = members.store
    this.routines = routines.store
    this.parts = {
      list: new Refresher(list, listWait, this.services),
      repositories: new Refresher(repositories, onEntry, this.services),
      builds: new Refresher(builds, buildsWait, this.services),
      members: new Refresher(members, onEntry, this.services),
      routines: new Refresher(routines, routinesWait, this.services),
    }
  }

  /**
   * A screen shows these parts. Each part reads at once, at each return of
   * the user to the page, and on its timer, until the last screen that
   * shows it calls the result. Screens that show a part share its reads.
   */
  watch(...parts: OrgPart[]): () => void {
    const releases = parts.map((part) => this.parts[part].watch())
    return () => {
      for (const release of releases) release()
    }
  }

  /** Reads a part now, such as for Try again. */
  reload(part: OrgPart): Promise<void> {
    return this.parts[part].refresh()
  }

  /** The draft of New workspace for a section. It stays while the app is open. */
  newWorkspace(sectionId: string | null): NewWorkspaceModel {
    const key = sectionId ?? ''
    let draft = this.drafts.get(key)
    if (!draft) {
      draft = new NewWorkspaceModel(this, sectionId)
      this.drafts.set(key, draft)
    }
    return draft
  }

  /**
   * Puts a newer record of a workspace in the list, such as from an event,
   * an open, Archive, or a create. Its place in the list stays.
   */
  putWorkspace(workspace: Workspace): void {
    this.resources.list.confirm(
      workspaceUpdated(workspace),
      `workspace ${workspace.id}`,
    )
  }

  /** A workspace as screens show it, as `workspaces` says. */
  workspace(workspaceId: string): Workspace | undefined {
    return valueOf(this.workspaces.get())?.find(
      (item) => item.id === workspaceId,
    )
  }

  /** A workspace as the server confirmed it, as `confirmedWorkspaces` says. */
  confirmedWorkspace(workspaceId: string): Workspace | undefined {
    return valueOf(this.confirmedWorkspaces.get())?.find(
      (item) => item.id === workspaceId,
    )
  }

  /**
   * Build computer, and Try again after a failed build. The new build goes
   * to the builds, so each screen that shows them follows it. An answer
   * with a build that ended already, such as one that failed at its start,
   * reads the builds again while `current` says that its screen shows.
   */
  async startBuild(current: () => boolean = () => true): Promise<void> {
    const started = await this.services.api.send(
      'POST',
      orgSettingsPaths.builds(this.orgId),
      {},
      readBuildResponse,
    )
    this.putBuild(started.build)
    if (current() && started.build.state !== 'running') {
      void this.reload('builds')
    }
  }

  /** Puts a newer record of a build in the history, newest first. */
  putBuild(build: ImageBuild): void {
    this.resources.builds.confirm(
      (builds) => ({
        ...builds,
        builds: [
          build,
          ...builds.builds.filter((item) => item.id !== build.id),
        ],
        currentImageBuildId:
          build.state === 'succeeded' ? build.id : builds.currentImageBuildId,
      }),
      `build ${build.id}`,
    )
  }

  /** Forgets the GitHub access of the person who signed out. */
  forgetGitHubAccess(): void {
    this.githubAccess.clear()
  }

  /**
   * The last GitHub access of the signed-in member to one repository of
   * the org, as the pull request bar read it. The bar of another workspace
   * of the repository shows it at once, while it reads the access again.
   * A sign-out or another person forgets it, as `forgetGitHubAccess` says.
   */
  githubAccessOf(repositoryId: string): {
    get: () => GitHubCapabilities | undefined
    set: (access: GitHubCapabilities | undefined) => void
  } {
    return {
      get: () => this.githubAccess.get(repositoryId),
      set: (access) => {
        if (access) this.githubAccess.set(repositoryId, access)
        else this.githubAccess.delete(repositoryId)
      },
    }
  }
}

/** The build that new workspaces start from, the newest good build. */
export function currentBuild(builds: BuildsResponse): ImageBuild | undefined {
  return (
    builds.builds.find((build) => build.id === builds.currentImageBuildId) ??
    builds.builds.find((build) => build.state === 'succeeded')
  )
}

/**
 * The newest run of the install script, which the Cloud computer tab shows
 * first. A refresh only fetches commits, so it does not count.
 */
export function latestBuild(builds: BuildsResponse): ImageBuild | undefined {
  return builds.builds
    .filter((build) => build.kind === 'build')
    .sort((a, b) => b.startedAt - a.startedAt)[0]
}
