import type { Agent } from '../shared/generated/Agent'
import {
  ACCOUNT_PATHS,
  type AccountResponse,
  type AgentLoginStatus,
} from '../shared/account'
import type { AgentLogins } from './agent-logins'
import { readAccount } from './api/read-core'
import type { AppModel } from './app-model'
import type { Store } from './store'

const refreshWait = 60_000

/** Shared login reads for list opens, page returns, and endpoint model updates. */
export class AccountLoginReads {
  private running: Promise<void> | null = null
  private cancelTimer: (() => void) | null = null
  private readonly app: AppModel
  private readonly account: Store<AccountResponse | null>
  private readonly logins: AgentLogins

  constructor(
    app: AppModel,
    account: Store<AccountResponse | null>,
    logins: AgentLogins,
  ) {
    this.app = app
    this.account = account
    this.logins = logins
    app.boot.subscribe(() => this.follow())
    account.subscribe(() => this.follow())
    const pageChanged = () => {
      if (app.boot.get().state === 'ready' && app.services.visible.get())
        void this.refresh()
      else this.clearTimer()
    }
    app.services.onFocus(pageChanged)
    app.services.visible.subscribe(pageChanged)
  }

  refresh(): Promise<void> {
    if (this.running) return this.running
    this.clearTimer()
    this.running = this.read().finally(() => {
      this.running = null
      this.follow()
    })
    return this.running
  }

  /** Reads one login after its save or model refresh, with the caller's mark. */
  async readAgent(
    agent: Agent,
    show: (logins: readonly AgentLoginStatus[]) => void,
  ): Promise<void> {
    const account = await this.app.services.api.get(
      ACCOUNT_PATHS.account,
      readAccount,
    )
    show(account.agentLogins.filter((login) => login.agent === agent))
  }

  private async read(): Promise<void> {
    const boot = this.app.boot.get()
    const show = this.logins.mark()
    const account = await this.app.services.api
      .get(ACCOUNT_PATHS.account, readAccount)
      .catch(() => null)
    if (account && this.app.boot.get() === boot) show(account.agentLogins)
  }

  private follow(): void {
    const endpoints = this.account
      .get()
      ?.agentLogins.some(
        (login) => login.connected && login.kind === 'endpoint',
      )
    if (
      this.running ||
      this.app.boot.get().state !== 'ready' ||
      !this.app.services.visible.get() ||
      !endpoints
    ) {
      this.clearTimer()
      return
    }
    this.cancelTimer ??= this.app.services.delay(refreshWait, () => {
      this.cancelTimer = null
      return this.refresh()
    })
  }

  private clearTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }
}
