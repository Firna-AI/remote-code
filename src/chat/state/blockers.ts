import type { Agent } from '../../shared/generated/Agent'
import { loginUsable } from '../../app/api/read-core'
import type { ChatSnapshot } from './chat-snapshot'
import { sessionLoginOf } from './session-login'

/**
 * Why a message waits: the login that the message needs is missing. While
 * the account is unknown, nothing blocks.
 *
 * A message in the reader's own session needs that session's login, and the
 * session record says whether it works, because the account can be older.
 * A message in the session of another member, whose login works, needs no
 * login of the reader. A message that starts a linked session needs a login
 * of the reader that the account names and that the app can still use. A
 * loaded account without an entry for the agent has no login for it.
 */
export interface SendBlock {
  /** The agent of the chosen model, which has no login. */
  agent: Agent
}

export function sendBlock(
  snapshot: ChatSnapshot,
  sessionId: string | null,
): SendBlock | null {
  const session = snapshot.sessions.find((item) => item.id === sessionId)
  if (!session || !snapshot.account) return null
  const { agent } = session.choice
  const view = sessionLoginOf(session, snapshot.account.user.id)
  if (view === null || view.kind === 'member') return null
  if (view.kind === 'own') return view.available ? null : { agent }
  const login = snapshot.account.agentLogins.find(
    (item) => item.agent === agent,
  )
  return loginUsable(login) ? null : { agent }
}
