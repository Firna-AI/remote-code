import type { Session } from '../../src/shared/generated/Session'

import { HttpError } from '../http'
import type { ChatTransaction } from './store'

export async function sessionFor(
  transaction: ChatTransaction,
  id: string,
): Promise<Session> {
  const session = await transaction.session(id)
  if (!session)
    throw new HttpError(
      404,
      'session_not_found',
      'The session is not available.',
    )
  return session
}
