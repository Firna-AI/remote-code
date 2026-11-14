import type { Session } from '../../shared/generated/Session'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { UserMessage } from '../../shared/generated/UserMessage'
import { chatHistoryPath } from '../../shared/events'
import type { SendMessageResponse } from '../../shared/messages'
import { sessionsPath } from '../../shared/sessions'
import type { FakeApiServer } from '../../test-support/fake-api'
import {
  FAKE_IDS,
  FAKE_TIME,
  fakeUsers,
} from '../../test-support/fixtures/core'
import {
  senderSnapshot,
  workspaceFixtures,
} from '../../test-support/fixtures/workspaces'
import type { RecordedChatScenario } from '../../test-support/recorded-chat'
import { record, text } from '../api/json'
import { chatFor, newSessionRecord } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace

/** Priya, the member who is not an admin, who reads the member role. */
const priya = senderSnapshot(fakeUsers[1])

const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}

/** The ID of the linked session that the fake opens. */
export const LINKED = 'linked-1'

/** The linked session that a message of Priya opened from the first session. */
export function linkedRecord(more: Partial<Session> = {}): Session {
  return newSessionRecord(LINKED, opus, null, {
    startedBy: priya,
    sourceSessionId: FAKE_IDS.session,
    ...more,
  })
}

/** A message of Priya that a session took. */
export function acceptedIn(
  sessionId: string,
  id: string,
  words: string,
): UserMessage {
  return {
    id,
    sessionId,
    sender: priya,
    text: words,
    attachments: [],
    choice: opus,
    createdAt: FAKE_TIME,
    state: 'sent',
  }
}

/** Writes the open sessions of the fake, each one changed by `change`. */
export function withSessions(
  server: FakeApiServer,
  change: (session: Session) => Session,
): void {
  const { sessions } = workspaceFixtures()
  server.json('GET', sessionsPath(org, ws), {
    ...sessions,
    sessions: sessions.sessions.map(change),
  })
}

/** The login of the starter of a session is not available. */
export const loginGone = (session: Session): Session => ({
  ...session,
  loginAvailable: false,
})

/** The starter of a session keeps a login that works for their own messages. */
export const loginPrivate = (session: Session): Session => ({
  ...session,
  loginShared: false,
})

/**
 * Answers each Send and Try again as the Worker does when the login of the
 * starter is not available: a new linked session takes the message, and the
 * reply names it with its record. A retry sends the message of the fixture
 * again as `retry-1`. The linked session has an empty history.
 */
function opensLinked(server: FakeApiServer) {
  server.json('GET', chatHistoryPath(org, ws, LINKED), {
    events: [],
    throughEventNumber: 0,
  })
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname
    const retry = path.endsWith('/retry')
    if (request.method !== 'POST' || (!retry && !path.endsWith('/messages'))) {
      return null
    }
    const body = retry ? null : record(await request.json())
    const message = body
      ? acceptedIn(LINKED, text(body.id), text(body.text))
      : acceptedIn(LINKED, 'retry-1', workspaceFixtures().message.text)
    const reply: SendMessageResponse = {
      eventNumber: 0,
      message,
      turnId: 'turn-9',
      session: linkedRecord(),
    }
    return Response.json(reply, { status: 202 })
  }
}

/** The message of Priya in the tests of linked sessions. */
export const askedText = 'Show a loading state under the address line.'

export const isSend = (request: Request) =>
  request.method === 'POST' && request.url.endsWith('/messages')

export type MemberChat = ReturnType<typeof chatFor>
type Answer = (request: Request) => Promise<Response | null>

/**
 * The chat of Priya, a member, in sessions that Cal started, whose login is
 * not available. Each Send and Try again opens the linked session, unless
 * `wrap` answers otherwise.
 */
export function memberChat(
  options: {
    conversation?: RecordedChatScenario
    change?: (session: Session) => Session
    hold?: (request: Request) => boolean
    wrap?: (opens: Answer) => Answer
  } = {},
): MemberChat {
  let answer: Answer = async () => null
  const chat = chatFor({
    role: 'member',
    conversation: options.conversation ?? 'history',
    hold: options.hold,
    answer: (request) => answer(request),
  })
  withSessions(chat.server, options.change ?? loginGone)
  const opens = opensLinked(chat.server)
  answer = options.wrap?.(opens) ?? opens
  return chat
}

/** The texts of the sent messages that a session holds until it shows them. */
export function pendingIn(chat: MemberChat, sessionId: string): string[] {
  const state = chat.controller.getSnapshot().sessionStates[sessionId]
  return (state?.pending ?? []).map((message) => message.text)
}

/** The Worker's events after it opened the linked session with the message. */
export function streamLinked(
  chat: MemberChat,
  more: Partial<Session> = {},
): void {
  chat.emit({ type: 'session.updated', session: linkedRecord(more) })
  chat.emit({
    type: 'message.accepted',
    message: acceptedIn(LINKED, 'client-1', askedText),
  })
}
