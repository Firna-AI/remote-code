import type { Session } from '../../src/shared/generated/Session'

import type { TurnStopRequester } from '../../src/shared/session-stop'
import type { ChatTransaction } from './store'
import { stopTurn } from './sessions'

export async function renameSession(
  transaction: ChatTransaction,
  session: Session,
  title: string,
): Promise<Session> {
  session.title = title
  await transaction.saveSession(session)
  await transaction.emit({ type: 'session.updated', session })
  return session
}

export async function stopManagedSession(
  transaction: ChatTransaction,
  session: Session,
  commandId: string,
  requester: TurnStopRequester,
) {
  if (session.activeTurnId === null)
    return { turnId: null, state: 'idle' as const }
  return stopTurn(
    transaction,
    session,
    session.activeTurnId,
    commandId,
    requester,
  )
}
