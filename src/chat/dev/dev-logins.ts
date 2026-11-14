import type { Session } from '../../shared/generated/Session'
import type { UserMessage } from '../../shared/generated/UserMessage'
import { followUpDraft } from '../../../docs/mockups/src/fixtures/conversations'
import { ACCOUNT_PATHS, type AgentLoginStatus } from '../../shared/account'
import type { SessionsResponse } from '../../shared/sessions'
import {
  workspaceViewPath,
  type WorkspaceTab,
  type WorkspaceView,
} from '../../shared/workspace-view'
import type { FakeApiServer } from '../../test-support/fake-api'
import { coreFixtures } from '../../test-support/fixtures/core'
import type { DevBackend } from './dev-backend'
import type { DevOptions } from './dev-options'
import { setActiveTurn, targetOf, titleFromMessage } from './dev-sessions'

/** A session record as the `starter` option draws it. */
function starterRecord(
  session: Session,
  starter: Exclude<DevOptions['starter'], 'on'>,
): Session {
  if (starter === 'none') {
    return { ...session, startedBy: null, loginAvailable: false }
  }
  if (starter === 'private') return { ...session, loginShared: false }
  return { ...session, loginAvailable: false }
}

/**
 * The session records of the `starter` option. With `off` and `linked`, the
 * login of each starter is not available. With `private`, each starter keeps
 * a login that works for their own messages only. With `none`, the records
 * are older ones that name no starter, as the Worker reads them.
 */
export function withStarter(
  list: SessionsResponse,
  starter: DevOptions['starter'],
): SessionsResponse {
  if (starter === 'on') return list
  const change = (session: Session) => starterRecord(session, starter)
  return {
    ...list,
    sessions: list.sessions.map(change),
    history: list.history.map(change),
  }
}

/**
 * The agent logins of the reader, as the account of the page names them.
 * Without a Claude login, it writes an account that names none. The admin
 * started the sessions, so a starter login that is not available is also
 * the admin's own missing login.
 */
export function writeReaderLogins(
  server: FakeApiServer,
  options: DevOptions,
): readonly AgentLoginStatus[] {
  const { account } = coreFixtures(options.role)
  const ownGone = options.role === 'admin' && options.starter === 'off'
  if (options.login && !ownGone) return account.agentLogins
  const agentLogins: readonly AgentLoginStatus[] = [
    { agent: 'claude', connected: false },
    account.agentLogins[1],
  ]
  server.json('GET', ACCOUNT_PATHS.account, { ...account, agentLogins })
  return agentLogins
}

/**
 * The records when the reader has no Claude login: each Claude session that
 * the reader started has a login that is not available, as the Worker says.
 */
export function withReaderLogin(
  list: SessionsResponse,
  readerId: string,
  claudeLogin: boolean,
): SessionsResponse {
  if (claudeLogin) return list
  const change = (session: Session): Session =>
    session.startedBy?.id === readerId && session.choice.agent === 'claude'
      ? { ...session, loginAvailable: false }
      : session
  return {
    ...list,
    sessions: list.sessions.map(change),
    history: list.history.map(change),
  }
}

/**
 * The linked session of `starter=linked`. The reader's message in the first
 * session opened it, as the Worker does when the login of the starter is not
 * available. That message gives its title. Its turn has started, and no
 * scripted agent answers, so the page stays still for a capture. It shows as
 * the last tab.
 */
export function seedLinked(
  backend: DevBackend,
  view: WorkspaceView | null,
): void {
  const [first] = backend.open
  if (!first) return
  const linked = targetOf(backend, first)
  if (linked.id === first.id) return
  const now = backend.clock.now()
  const message: UserMessage = {
    id: 'dev-linked-message',
    sessionId: linked.id,
    sender: backend.viewer,
    text: followUpDraft,
    attachments: [],
    choice: linked.choice,
    createdAt: now,
    state: 'sent',
  }
  const turnId = 'dev-linked-turn'
  backend.messages.set(message.id, message)
  backend.stream.emit({ type: 'message.accepted', message })
  titleFromMessage(backend, message)
  backend.stream.emit({
    type: 'turn.started',
    sessionId: linked.id,
    turnId,
    senderId: backend.viewer.id,
    choice: linked.choice,
    startedAt: now,
    messageIds: [message.id],
  })
  backend.recordedTurns.set(linked.id, turnId)
  setActiveTurn(backend, linked.id, turnId, now)
  const tab: WorkspaceTab = { kind: 'session', sessionId: linked.id }
  const { orgId, workspaceId } = backend.target
  backend.server.json('GET', workspaceViewPath(orgId, workspaceId), {
    view: {
      tabs: [...(view?.tabs ?? []), tab],
      activeTab: tab,
      temporaryTab: view?.temporaryTab ?? null,
      fileList: view?.fileList ?? 'changes',
      tool: view?.tool ?? 'terminal',
    },
  })
}
