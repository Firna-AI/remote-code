import type { Agent } from '../shared/generated/Agent'
import type { AgentChoice } from '../shared/generated/AgentChoice'
import {
  ACCOUNT_PATHS,
  agentLoginPath,
  refreshAgentLoginModelsPath,
  codexDevicePath,
  type AccountResponse,
  type AgentLoginStatus,
  type GitHubInstallationsResponse,
  type GitHubRepositoriesResponse,
  type NewWorkspaceView,
  type PollCodexDeviceResponse,
  type SaveAgentLoginRequest,
  type StartCodexDeviceResponse,
  type UpdateAgentLoginRequest,
  type UpdateAgentLoginResponse,
} from '../shared/account'
import { API_PATHS } from '../shared/api'
import type { SaveShortcutsRequest } from '../shared/shortcuts'
import { WAITLIST_PATHS, type WaitlistStateResponse } from '../shared/waitlist'
import { AgentLogins } from './agent-logins'
import { AccountLoginReads } from './account-login-reads'
import { ignore, nested, record } from './api/parse'
import {
  readChoice,
  readCodexDevicePoll,
  readCodexDeviceStart,
  readGitHubRepositories,
  readInstallations,
  readLogin,
  readNewWorkspaceView,
} from './api/read-core'
import { readSavedShortcuts } from './api/read-shortcuts'
import { readWaitlistState } from './api/read-waitlist'
import type { AppModel } from './app-model'
import { Refresher } from './refresh'
import { Resource } from './resource'
import type { AppServices } from './services'
import { load, loading, Store, type Loadable, type Readable } from './store'

/**
 * The account of the person signed in: the agent logins, the preferences,
 * the shortcut changes, and the GitHub App installations. A secret goes to
 * the Worker in a write and never comes back. The Worker keeps ChatGPT
 * tokens. The account shows each login's kind and share setting, which
 * says whether other members' messages in the person's sessions run on it.
 * Own endpoints also show their host and model list, which the owner's
 * pickers follow.
 */
export class AccountModel {
  readonly account = new Store<AccountResponse | null>(null)
  readonly installations: Readable<Loadable<GitHubInstallationsResponse>>
  /** The repositories that Create org offers, before the org exists. */
  readonly repositories = new Store<Loadable<GitHubRepositoriesResponse>>(
    loading,
  )
  /**
   * The waitlist state of the user, for the invite code of the account:
   * the code with its uses, and whether sign-ups are paused.
   */
  readonly waitlist = new Store<Loadable<WaitlistStateResponse>>(loading)
  /** The logins of `account`, in the order of their changes. */
  private readonly logins = new AgentLogins(this.account)
  private readonly loginReads: AccountLoginReads
  private readonly services: AppServices
  private readonly app: AppModel
  private readonly installationReads: Refresher<GitHubInstallationsResponse>
  /** The read of the steps that a return to the page started, while it runs. */
  private stepsOnReturn: Promise<void> | null = null

  constructor(services: AppServices, app: AppModel) {
    this.services = services
    this.app = app
    this.loginReads = new AccountLoginReads(app, this.account, this.logins)
    const installations = new Resource(() =>
      services.api.get(ACCOUNT_PATHS.githubInstallations, readInstallations),
    )
    this.installations = installations.store
    this.installationReads = new Refresher(installations, () => null, services)
  }

  /**
   * Reads the installs while a screen shows them: at once, and each time
   * that the user comes back to the page, such as from GitHub in another
   * window. A return also reads the steps of Get started again, because an
   * install completes its first step. A failed read keeps what shows.
   */
  watchInstallations(): () => void {
    const stopReads = this.installationReads.watch()
    const stopSteps = this.services.onFocus(() => this.readStepsOnReturn())
    return () => {
      stopReads()
      stopSteps()
    }
  }

  /**
   * Reads the steps of Get started after a return to the page. One return
   * to a browser tab can call the focus listener twice, once for the focus
   * and once for the page that shows again, so a return shares a read that
   * runs already. A read after a step does not share it, so that it reads
   * the change of that step.
   */
  private readStepsOnReturn(): void {
    this.stepsOnReturn ??= this.app
      .refreshGetStarted()
      .catch(() => undefined)
      .finally(() => {
        this.stepsOnReturn = null
      })
  }

  /** Reads the installs now, such as for Try again after a failed read. */
  loadInstallations(): Promise<void> {
    return this.installationReads.refresh()
  }

  /** Reads the invite code each time that the account opens, as its uses change. */
  loadWaitlist(): Promise<void> {
    return load(this.waitlist, () =>
      this.services.api.get(WAITLIST_PATHS.state, readWaitlistState),
    )
  }

  loadRepositories(): Promise<void> {
    return load(this.repositories, () =>
      this.services.api.get(
        ACCOUNT_PATHS.githubRepositories,
        readGitHubRepositories,
      ),
    )
  }

  /**
   * The API refused an operator request, so the person is no longer an
   * operator. The rail and the org switcher drop Operator, and the operator
   * section shows the not-found page, until the next load reads the account.
   */
  refuseOperator(): void {
    const account = this.account.get()
    if (account?.operator) this.account.set({ ...account, operator: false })
  }

  /**
   * Reads the agent logins again, as each open of the agent list does, so
   * that a login that the Worker stopped after the app opened shows Signed
   * out. Only the read of the whole account gives the logins, and only its
   * logins show. A read that runs already counts for this call. A failed
   * read keeps what shows.
   */
  refreshLogins(): Promise<void> {
    return this.loginReads.refresh()
  }

  login(agent: Agent): AgentLoginStatus {
    return this.logins.get(agent)
  }

  /**
   * Saves a login. The save of an own endpoint also reads the model list of
   * the endpoint, which its answer does not hold, so the account is read
   * again for it. A failed read of the account leaves the saved login
   * without its list, so the pickers hide nothing until the next read.
   */
  async saveLogin(request: SaveAgentLoginRequest): Promise<void> {
    const saved = await this.services.api.send(
      'PUT',
      agentLoginPath(request.agent),
      request,
      readLogin,
    )
    this.logins.put(saved)
    if (saved.connected && saved.kind === 'endpoint')
      await this.loginReads
        .readAgent(saved.agent, this.logins.mark())
        .catch(() => undefined)
  }

  /**
   * Starts a ChatGPT sign-in of Codex. The Worker asks OpenAI for a code,
   * and keeps the sign-in under the handle of the answer. No token comes to
   * the browser.
   */
  startCodexSignIn(): Promise<StartCodexDeviceResponse> {
    return this.services.api.send(
      'POST',
      ACCOUNT_PATHS.codexDevice,
      {},
      readCodexDeviceStart,
    )
  }

  /**
   * Asks the Worker for the state of the ChatGPT sign-in of `handle`. At the
   * end of a sign-in, the Worker saved the login, so the account shows it as
   * the Codex login, as a save does.
   */
  async pollCodexSignIn(handle: string): Promise<PollCodexDeviceResponse> {
    const answer = await this.services.api.send(
      'POST',
      codexDevicePath(handle),
      {},
      readCodexDevicePoll,
    )
    if (answer.state === 'connected') this.logins.put(answer.login)
    return answer
  }

  /** Refreshes an endpoint list, without restoring a changed login. */
  async refreshModels(agent: Agent): Promise<void> {
    const show = this.logins.mark()
    await this.services.api.send(
      'POST',
      refreshAgentLoginModelsPath(agent),
      {},
      ignore,
    )
    await this.loginReads.readAgent(agent, show)
  }

  /**
   * Saves whether the messages of other members in the sessions of the user
   * run on a login of the user. The reply holds the saved status of the
   * login, which can say that the login is gone. A save, a remove, or
   * another share change that comes first makes the reply old, so it does
   * not show. A reply that shows is a change too, so that a read of the
   * logins that ran meanwhile does not take it back.
   */
  async setNoReuse(agent: Agent, noReuse: boolean): Promise<void> {
    const change = this.logins.change(agent)
    const request: UpdateAgentLoginRequest = { noReuse }
    const saved: UpdateAgentLoginResponse = await this.services.api.send(
      'PATCH',
      agentLoginPath(agent),
      request,
      readLogin,
    )
    this.logins.putReply(change, saved)
  }

  async removeLogin(agent: Agent): Promise<void> {
    await this.services.api.send('DELETE', agentLoginPath(agent), {}, ignore)
    this.logins.put({ agent, connected: false })
  }

  async setDefaultChoice(choice: AgentChoice): Promise<void> {
    const saved = await this.services.api.send(
      'PUT',
      ACCOUNT_PATHS.defaultModel,
      { choice },
      (body) => nested(record(body), 'choice', readChoice),
    )
    const account = this.account.get()
    if (account) this.account.set({ ...account, defaultChoice: saved })
  }

  async setNewWorkspaceView(view: NewWorkspaceView): Promise<void> {
    const saved = await this.services.api.send(
      'PUT',
      ACCOUNT_PATHS.newWorkspaceView,
      { view },
      readNewWorkspaceView,
    )
    const account = this.account.get()
    if (account) this.account.set({ ...account, newWorkspaceView: saved.view })
  }

  /**
   * Saves the shortcut changes of one keyboard in one batch: all of them or
   * none. The reply holds every change of that keyboard, which the keymap
   * of the keys and of each hint read from the account. A failed save
   * changes nothing, so the account keeps the saved keys.
   */
  async saveShortcuts(request: SaveShortcutsRequest): Promise<void> {
    const saved = await this.services.api.send(
      'PUT',
      ACCOUNT_PATHS.shortcuts,
      request,
      readSavedShortcuts,
    )
    const account = this.account.get()
    if (!account) return
    this.account.set({
      ...account,
      shortcuts: { ...account.shortcuts, [saved.keyboard]: saved.changes },
    })
  }

  async signOut(): Promise<void> {
    await this.services.api.send('POST', API_PATHS.signOut, {}, ignore)
    this.app.boot.set({ state: 'signed-out' })
  }
}
