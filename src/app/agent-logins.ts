import type { Agent } from '../shared/generated/Agent'
import type { AccountResponse, AgentLoginStatus } from '../shared/account'
import type { Store } from './store'

/**
 * The agent logins in the account store, and the order of the changes that
 * show there. Each local change of a login counts one up: a save, a remove,
 * a connected sign-in, and a share change, at its start and when its reply
 * shows. A share reply and a read show a login only while no later change
 * of that login came first, so a removed login stays removed, and a read
 * never takes back a local change.
 */
export class AgentLogins {
  /** The number of the last change of each agent login. */
  private readonly changes = new Map<Agent, number>()
  private readonly account: Store<AccountResponse | null>

  constructor(account: Store<AccountResponse | null>) {
    this.account = account
  }

  /** The login of `agent`, or a login that is not connected. */
  get(agent: Agent): AgentLoginStatus {
    return (
      this.account.get()?.agentLogins.find((item) => item.agent === agent) ?? {
        agent,
        connected: false,
      }
    )
  }

  /** Counts a change of the login of `agent`, and gives its number. */
  change(agent: Agent): number {
    const change = (this.changes.get(agent) ?? 0) + 1
    this.changes.set(agent, change)
    return change
  }

  /** Shows a login that a write gave, as a change of its own. */
  put(login: AgentLoginStatus): void {
    this.change(login.agent)
    this.show(login)
  }

  /**
   * Shows `login`, the reply to the change `change` of its login, as a
   * change of its own, unless a later change of that login came first.
   */
  putReply(change: number, login: AgentLoginStatus): void {
    if (this.changes.get(login.agent) === change) this.put(login)
  }

  /**
   * Marks the changes before a read. The result shows each login of the
   * answer whose agent had no change after the mark.
   */
  mark(): (logins: readonly AgentLoginStatus[]) => void {
    const marked = new Map(this.changes)
    return (logins) => {
      for (const login of logins) {
        if (this.changes.get(login.agent) === marked.get(login.agent)) {
          this.show(login)
        }
      }
    }
  }

  private show(login: AgentLoginStatus): void {
    const account = this.account.get()
    if (!account) return
    const others = account.agentLogins.filter(
      (item) => item.agent !== login.agent,
    )
    this.account.set({
      ...account,
      agentLogins: [...others, login].sort((a, b) =>
        a.agent.localeCompare(b.agent),
      ),
    })
  }
}
