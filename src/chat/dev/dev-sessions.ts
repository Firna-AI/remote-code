import type { Session } from '../../shared/generated/Session'
import type { UserMessage } from '../../shared/generated/UserMessage'
import { chatHistoryPath } from '../../shared/events'
import { sessionTitleFrom } from '../../shared/session-title'
import { hasOwnWords } from '../../shared/attachment-mentions'

import type { DevBackend } from './dev-backend'

/** The title of a new workspace, in place of the title model of the Worker. */
export const WORKSPACE_TITLE = 'Saved carts'

/** The time that the title model takes to answer: about a second. */
const TITLE_DELAY_MS = 1_000

/**
 * An automatic name fills a name only while it is empty, and never in an
 * archived workspace, as the Worker does. So a name that a member set never
 * changes.
 */
function canFill(backend: DevBackend, name: string | null): boolean {
  return name === null && backend.workspace.state !== 'archived'
}

/** Places a session among the tabs or in the history, and tells the tabs. */
export function place(backend: DevBackend, session: Session): void {
  const others = (items: Session[]) =>
    items.filter((item) => item.id !== session.id)
  if (session.closedAt === null) {
    backend.open = [...others(backend.open), session]
    backend.closed = others(backend.closed)
  } else {
    backend.open = others(backend.open)
    backend.closed = [session, ...others(backend.closed)]
  }
  backend.stream.emit({ type: 'session.updated', session })
  backend.sync()
}

/** The record of a session as the page holds it now. */
export function recordOf(
  backend: DevBackend,
  sessionId: string,
): Session | undefined {
  return [...backend.open, ...backend.closed].find(
    (item) => item.id === sessionId,
  )
}

/**
 * Names the active turn of a session in its record, with its start time, or
 * no turn after its end, as the Worker does. The chat ends a turn that a
 * newer record no longer names.
 */
export function setActiveTurn(
  backend: DevBackend,
  sessionId: string,
  turnId: string | null,
  startedAt: number | null,
): void {
  const session = recordOf(backend, sessionId)
  if (!session || session.activeTurnId === turnId) return
  place(backend, {
    ...session,
    activeTurnId: turnId,
    activeTurnStartedAt: turnId === null ? null : startedAt,
  })
}

/** An accepted message ends the retry of its session, as the Worker does. */
export function clearRetry(backend: DevBackend, sessionId: string): void {
  const session = recordOf(backend, sessionId)
  if (session && session.retryMessageId !== null) {
    place(backend, { ...session, retryMessageId: null })
  }
}

/**
 * A later session, each session but the first session of a new workspace,
 * takes the first line of an accepted message as its title while it has no
 * title, as the Worker does. So a name that a member gave the session stays,
 * and a message with only its attached files leaves the session untitled.
 */
export function titleFromMessage(
  backend: DevBackend,
  message: UserMessage,
): void {
  const session = recordOf(backend, message.sessionId)
  if (!session || session.id === backend.titled) return
  const title = canFill(backend, session.title)
    ? sessionTitleFrom(message.text, message.attachments)
    : null
  if (title !== null) place(backend, { ...session, title })
}

/**
 * A new session that the reader of the page starts, as its starter. `id` is
 * the ID that the chat chose, and `source` the session that a linked session
 * points to. Its record takes the reader's login of its agent, as the Worker
 * records it: available while connected, and shared unless the reader keeps
 * it private. Without a connected login, it is neither.
 */
export function newSession(
  backend: DevBackend,
  choice: Session['choice'],
  options: { id?: string; source?: string } = {},
): Session {
  const login = backend.logins.find((item) => item.agent === choice.agent)
  backend.count += 1
  const { orgId, workspaceId } = backend.target
  const session: Session = {
    id: options.id ?? `dev-session-${backend.count}`,
    workspaceId,
    title: null,
    choice,
    createdAt: backend.clock.now(),
    closedAt: null,
    activeTurnId: null,
    activeTurnStartedAt: null,
    retryMessageId: null,
    startedBy: backend.viewer,
    sourceSessionId: options.source ?? null,
    loginAvailable: login?.connected ?? false,
    loginShared: login?.connected === true && !login.noReuse,
  }
  backend.server.json('GET', chatHistoryPath(orgId, workspaceId, session.id), {
    events: [],
    throughEventNumber: backend.stream.last,
  })
  place(backend, session)
  return session
}

/**
 * The session where a message of the reader goes, as the Worker chooses it.
 * The session itself takes it while its starter shares a login that works,
 * or when the reader started it. Otherwise a new linked session on the
 * reader's own login takes it, and the first session names no retry any
 * more.
 */
export function targetOf(backend: DevBackend, session: Session): Session {
  const { startedBy } = session
  const own = startedBy !== null && startedBy.id === backend.viewer.id
  const shared = session.loginAvailable && session.loginShared
  if (own || (startedBy !== null && shared)) return session
  const linked = newSession(backend, session.choice, { source: session.id })
  clearRetry(backend, session.id)
  return linked
}

/**
 * The title of a workspace, as the Worker stores it. The workspace takes it
 * as its name only while it has no name. The first session of a new
 * workspace takes it too, while that session has no title, so a name that a
 * user gave the session stays. The backend gives these titles. This page
 * does the same, so its tabs match the mockups.
 */
export function writeTitle(backend: DevBackend, name: string): void {
  if (!canFill(backend, backend.workspace.name)) return
  backend.workspace = { ...backend.workspace, name }
  backend.stream.emit({ type: 'workspace.title', name })
  const first = backend.titled ? recordOf(backend, backend.titled) : undefined
  if (first && first.title === null) {
    place(backend, { ...first, title: name })
  } else {
    backend.sync()
  }
}

/**
 * A message with text that the page accepts asks for the title of a
 * workspace with no name, as the Worker asks its title model. The title
 * comes about a second later, whether or not the sandbox is ready. A message
 * with only its attached-file mentions asks nothing. The next message with
 * its own words asks. The page
 * asks once, because its title never fails. A name that the workspace has
 * by then, such as from a button of the page, stays.
 */
export function askTitle(backend: DevBackend, message: UserMessage): void {
  if (
    !canFill(backend, backend.workspace.name) ||
    backend.titleAsked ||
    !hasOwnWords(message.text, message.attachments)
  )
    return
  backend.titleAsked = true
  backend.timers.push(
    window.setTimeout(
      () => writeTitle(backend, WORKSPACE_TITLE),
      TITLE_DELAY_MS,
    ),
  )
}

/**
 * A new workspace: it and its first session have no name yet, as the
 * backend gives them, and the first session follows the title of the
 * workspace. The create and the recorded chat accepted their messages
 * before the page loaded, so the first of them with text asks for the title
 * as the page loads.
 */
export function followTitle(backend: DevBackend): void {
  const [first] = backend.open
  if (!first) return
  backend.titled = first.id
  for (const message of backend.messages.values()) {
    askTitle(backend, message)
  }
}
