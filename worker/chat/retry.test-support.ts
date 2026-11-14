import type { Session } from '../../src/shared/generated/Session'
import type { WorkspaceSocketMessage } from '../../src/shared/events'
import {
  retryMessagePath,
  sessionsPath,
  type SessionsResponse,
} from '../../src/shared/sessions'
import { WORKSPACE_ID, type ChatFixture } from './harness.test-support'

export function retryRequest(
  fixture: ChatFixture,
  sessionId: string,
  messageId: string,
  cookie = fixture.ownerCookie,
) {
  return fixture.fetch(
    retryMessagePath(fixture.org.id, WORKSPACE_ID, sessionId, messageId),
    {},
    cookie,
  )
}

export async function sessionRecord(
  fixture: ChatFixture,
  sessionId: string,
): Promise<Session> {
  const response = await fixture.fetch(
    sessionsPath(fixture.org.id, WORKSPACE_ID),
  )
  const body: SessionsResponse = await response.json()
  const session = [...body.sessions, ...body.history].find(
    (session) => session.id === sessionId,
  )
  if (!session) throw new Error('The session is missing from the API reply.')
  return session
}

export function liveSessions(messages: readonly WorkspaceSocketMessage[]) {
  return messages.flatMap((message) =>
    message.type === 'event' &&
    message.envelope.event.type === 'session.updated'
      ? [message.envelope.event.session]
      : [],
  )
}

export const retryUnavailable = {
  error: {
    code: 'retry_not_available',
    message:
      'Only the newest failed request can run again. Send a new message.',
  },
}
