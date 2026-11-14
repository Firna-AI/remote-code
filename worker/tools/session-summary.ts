import type { AgentSessionSummary } from '../../src/shared/generated/AgentSessionSummary'
import type { Session } from '../../src/shared/generated/Session'

import { sessionLink } from '../../src/shared/session-link'

import type { ChatTransaction } from '../chat/store'

export async function toolSessionSummary(
  view: ChatTransaction,
  session: Session,
  orgId: string,
  origin: string,
): Promise<AgentSessionSummary> {
  const active = session.activeTurnId
    ? await view.turn(session.activeTurnId)
    : undefined
  const newest = await view.newestTurn(session.id)
  const state =
    active && ['queued', 'running', 'stopping'].includes(active.state)
      ? 'running'
      : newest && (await view.turn(newest))?.state === 'failed'
        ? 'failed'
        : 'idle'
  return {
    id: session.id,
    link: sessionLink(origin, orgId, view.workspaceId, session.id),
    title: session.title,
    choice: session.choice,
    startedBy: session.startedBy,
    closed: session.closedAt !== null,
    state,
  }
}
