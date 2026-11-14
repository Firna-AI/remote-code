import type { AgentModel } from '../../shared/generated/AgentModel'
import type { Workspace } from '../../shared/generated/Workspace'
import type { Readable } from '../../app/store'
import type { AccountResponse } from '../../shared/account'

import type { MembersResponse } from '../../shared/members'
import type { OrgSummary } from '../../shared/orgs'

import type { ChatSnapshot, ChatStore } from './chat-snapshot'

/**
 * The inputs of a chat that app models own, for a chat that the app keeps
 * while it shows other pages. With them, the chat sends none of these reads
 * and writes no value of its own for them. It shows the current value of
 * each source, and a change of a source, such as a login that the account
 * screen saves, shows at once, also while the chat is hidden. A chat
 * without sources reads each of these inputs at its load, and reads the
 * workspace list itself while it shows.
 */
export interface ChatSources {
  /** The signed-in user, the agent logins, and the default model. */
  account: Readable<AccountResponse | null>
  /** The org of the workspace, with the name and the role of the user. */
  org: Readable<OrgSummary | null>
  models: Readable<readonly AgentModel[]>
  /** The members of the org, or null until they load. */
  members: Readable<MembersResponse | null>
  /**
   * The workspaces of the org that the reader may see, with the archived
   * ones, or null until they load. The chips of the chat find them.
   */
  workspaces: Readable<readonly Workspace[] | null>
  /**
   * Keeps `workspaces` current while the chat shows, also on a phone, where
   * no list is on the screen. The result ends the watch.
   */
  watchWorkspaces: () => () => void
}

/** The snapshot with the current value of each source. */
export function withSources(
  snapshot: ChatSnapshot,
  sources: ChatSources,
): ChatSnapshot {
  const members = sources.members.get()
  return {
    ...snapshot,
    account: sources.account.get(),
    org: sources.org.get(),
    models: sources.models.get(),
    members: members ? members.members.map((member) => member.user) : [],
  }
}

/**
 * Puts each change of a source in the snapshot. The result ends the
 * subscriptions. A source sends no request, so a hidden chat that follows
 * them does no work until a value changes.
 */
export function followSources(
  store: ChatStore,
  sources: ChatSources,
): () => void {
  const update = () => store.update((current) => withSources(current, sources))
  const stops = [
    sources.account.subscribe(update),
    sources.org.subscribe(update),
    sources.models.subscribe(update),
    sources.members.subscribe(update),
  ]
  return () => {
    for (const stop of stops) stop()
  }
}
