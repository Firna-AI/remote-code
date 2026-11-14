import type { AgentModel } from '../shared/generated/AgentModel'

import { API_PATHS, type User } from '../shared/api'
import { GET_STARTED_PATH, type GetStartedResponse } from '../shared/onboarding'
import {
  leaveOrgPath,
  type CreateOrgRequest,
  type MoveOrgRequest,
  type OrgSummary,
  type RenameOrgRequest,
} from '../shared/orgs'
import type { ApiClient } from './api/client'
import { ignore } from './api/parse'
import { readGetStarted } from './api/read-core'
import { readSession } from './api/read-waitlist'
import { AccountModel } from './account-model'
import type { ComposerFocusRequest } from './composer-focus'
import { FeedbackModel } from './feedback-model'
import { failedBoot, readShared, type Boot } from './boot'
import { InvitationsModel } from './invitations-model'
import { LastWorkspaces } from './last-workspaces'
import { OrgList } from './org-list'
import { OrgModel } from './org-model'
import { patchOrg, postOrg } from './org-writes'
import { suspendedOrg } from './permissions'
import type { AppServices } from './services'
import { setupSteps } from './setup-steps'
import { Store, type Readable } from './store'
import { WaitlistModel } from './waitlist-model'

/**
 * The data that every screen shares: the person signed in, their orgs, the
 * models, and the steps of Get started. It also keeps one `OrgModel` for
 * each org that the user opens.
 */
export class AppModel {
  readonly boot = new Store<Boot>({ state: 'loading' })
  private readonly orgList = new OrgList()
  /** The orgs of the person in their own order, as `OrgList` says. */
  readonly orgs: Readable<readonly OrgSummary[]> = this.orgList
  /**
   * The orgs whose requests the API refused with `org_suspended`. Such a
   * refusal shows that the org is suspended, also while its summary is old.
   * It gives no time of the suspension, so the summary stays as the server
   * sent it.
   */
  readonly refusedOrgs = new Store<ReadonlySet<string>>(new Set())
  /**
   * The org that the person opened last in this tab, also a deleted one.
   * A page without an org works on it, as `keptOrg` says. The tab keeps it
   * in memory only.
   */
  readonly lastOrg = new Store<string | null>(null)
  /**
   * The last workspace of each org of the person signed in, which the
   * browser keeps, as `LastWorkspaces` says.
   */
  readonly lastWorkspaces: LastWorkspaces
  /**
   * The workspace whose message field takes the focus when its chat shows,
   * as `ComposerFocusRequest` says. The tab keeps it in memory only.
   */
  readonly composerFocus = new Store<ComposerFocusRequest | null>(null)
  readonly models = new Store<readonly AgentModel[]>([])
  /**
   * The steps of Get started as every screen shows them. Only the step of
   * the GitHub App comes from the reply of the API. The others follow the
   * org list and the account, as `setupSteps` says.
   */
  readonly getStarted: Readable<GetStartedResponse | null>
  readonly account: AccountModel
  readonly feedback: FeedbackModel
  /** The invitations that wait for the user, which Home shows first. */
  readonly invitations: InvitationsModel
  /** The waitlist screen of a person without app access. */
  readonly waitlist: WaitlistModel
  readonly services: AppServices
  private readonly orgModels = new Map<string, OrgModel>()
  /** The last reply of the API on the steps. No screen reads it as it is. */
  private readonly setupReply = new Store<GetStartedResponse | null>(null)
  private started = false
  /** The person of the last ready boot, whose creates the org models keep. */
  private userId: string | null = null
  /** The open of the app after app access arrived, while it runs. */
  private admitting: Promise<void> | null = null

  constructor(services: AppServices) {
    this.services = services
    this.lastWorkspaces = new LastWorkspaces(services.storage)
    this.account = new AccountModel(services, this)
    this.feedback = new FeedbackModel(this)
    this.getStarted = setupSteps({
      server: this.setupReply,
      orgs: this.orgs,
      account: this.account.account,
    })
    this.invitations = new InvitationsModel(this)
    this.waitlist = new WaitlistModel(this)
    // The model lives as long as its store, so it never unsubscribes.
    this.boot.subscribe(() => this.followPerson())
  }

  /**
   * A sign-out, or a sign-in of another person, ends the create requests
   * of every org that still run, so that their answers change nothing. It
   * also forgets the GitHub access of the person. The last workspaces
   * follow the person of each ready boot and each sign-out.
   */
  private followPerson(): void {
    const boot = this.boot.get()
    const person = boot.state === 'ready' ? boot.user.id : null
    if (boot.state === 'ready' || boot.state === 'signed-out') {
      this.lastWorkspaces.follow(person)
    }
    if (
      boot.state !== 'signed-out' &&
      (person === null || person === this.userId)
    ) {
      return
    }
    for (const org of this.orgModels.values()) {
      org.creations.clear()
      org.forgetGitHubAccess()
    }
    this.userId = person
  }

  /** Starts the first load once, also when React runs an effect twice. */
  ensureStarted(): void {
    if (this.started) return
    this.started = true
    void this.start()
  }

  /**
   * The first load: the session, then what every screen shares. A session
   * without app access reads only the waitlist state, and the app shows
   * the waitlist screen. A newer start makes an older one change nothing.
   */
  async start(): Promise<void> {
    const boot: Boot = { state: 'loading' }
    this.boot.set(boot)
    try {
      const session = await this.services.api.get(
        API_PATHS.session,
        readSession,
      )
      // The app access can arrive between the two reads.
      const waits = !session.appAccess && (await this.waitlist.load())
      if (this.boot.get() !== boot) return
      if (waits) {
        this.boot.set({ state: 'waiting', user: session.user })
        return
      }
      await this.openApp(boot, session.user)
    } catch (error) {
      this.fail(boot, error)
    }
  }

  /**
   * App access arrived for the person on the waitlist. The app reads what
   * every screen shares and opens as usual. A sign-out meanwhile changes
   * nothing. A failed read shows that the app did not load, with Try again.
   */
  admit(): Promise<void> {
    const boot = this.boot.get()
    if (boot.state !== 'waiting') return Promise.resolve()
    this.admitting ??= this.openApp(boot, boot.user)
      .catch((error: unknown) => this.fail(boot, error))
      .finally(() => {
        this.admitting = null
      })
    return this.admitting
  }

  /** Reads what every screen shares, and opens the app while `from` is the boot. */
  private async openApp(from: Boot, user: User): Promise<void> {
    const shared = await readShared(this.services.api)
    if (this.boot.get() !== from) return
    this.account.account.set(shared.account)
    this.orgList.load(shared.orgs)
    this.models.set(shared.models)
    this.setupReply.set(shared.getStarted)
    this.boot.set({ state: 'ready', user })
  }

  /** A load failed, while `from` is still the boot. */
  private fail(from: Boot, error: unknown): void {
    if (this.boot.get() === from) this.boot.set(failedBoot(error))
  }

  org(orgId: string): OrgModel {
    let model = this.orgModels.get(orgId)
    if (!model) {
      model = new OrgModel(this.services, orgId, {
        suspended: suspendedOrg(orgId, this.orgs, this.refusedOrgs),
        note: () => this.noteSuspended(orgId),
      })
      this.orgModels.set(orgId, model)
    }
    return model
  }

  /** The person opens a page of an org. */
  openOrg(orgId: string): void {
    this.lastOrg.set(orgId)
  }

  async refreshGetStarted(): Promise<void> {
    this.setupReply.set(
      await this.services.api.get(GET_STARTED_PATH, readGetStarted),
    )
  }

  /**
   * Takes a refusal with `org_suspended` for one of the org's requests, also
   * while the org list still shows the org in use. So a page with an old
   * org list shows the suspended org at once, and keeps it after an owner
   * change of a workspace.
   */
  noteSuspended(orgId: string): void {
    const refused = this.refusedOrgs.get()
    if (!refused.has(orgId)) this.refusedOrgs.set(new Set([...refused, orgId]))
  }

  /**
   * The client for the writes of one org: the client of its `OrgModel`. A
   * refusal with `org_suspended` marks the org, also while the org list is
   * old. A create and the account actions use the client of the app.
   */
  private orgApi(orgId: string): ApiClient {
    return this.org(orgId).services.api
  }

  /**
   * Puts a newer record of an org in the list of the user, such as the
   * answer of Delete org or Restore. The rail and the screens of the org
   * follow it.
   */
  putOrg(org: OrgSummary): void {
    this.orgList.put(org)
  }

  /**
   * Moves an org to `index` among the other orgs of the rail. The move
   * shows at once. A failure takes back only this move, and throws.
   */
  moveOrg(orgId: string, index: number): Promise<void> {
    const request: MoveOrgRequest = { orgId, index }
    return this.orgList.move(orgId, index, () =>
      this.services.api.send('PUT', API_PATHS.orgOrder, request, ignore),
    )
  }

  /**
   * Creates an org with its name, its custom initials, and the GitHub IDs
   * of the repositories that it chose from the account's list.
   */
  async createOrg(request: CreateOrgRequest): Promise<OrgSummary> {
    const org = await postOrg(this.services.api, request)
    this.putOrg(org)
    return org
  }

  /** Saves the name and the initials of an org. */
  async renameOrg(orgId: string, request: RenameOrgRequest): Promise<void> {
    this.putOrg(await patchOrg(this.orgApi(orgId), orgId, request))
  }

  /**
   * Leaves an org, and takes it out of the list of the user. A suspended
   * org takes a leave too, as its one change. The API refuses the leave of
   * the last active admin with `last_admin`, and the caller shows it.
   */
  async leaveOrg(orgId: string): Promise<void> {
    await this.orgApi(orgId).send('POST', leaveOrgPath(orgId), {}, ignore)
    this.orgList.remove(orgId)
  }
}
