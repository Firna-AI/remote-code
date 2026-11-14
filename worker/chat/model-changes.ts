import type { Session } from '../../src/shared/generated/Session'
import type { ChangeModelResponse } from '../../src/shared/sessions'
import type { User } from '../../src/shared/api'
import { HttpError } from '../http'
import { choice, draft, identifier } from './inputs'
import { SessionLogins } from './session-login'
import { createSession, queueModel } from './sessions'
import type { ChatTransaction } from './store'
import type { ChatDependencies } from './types'

/**
 * A model of the same agent stays in the session. A model of the other agent
 * also stays in a session with no message yet, because no agent conversation
 * exists yet. Then the login check runs again for the new agent. Otherwise a
 * model of the other agent opens a new session (decision 51).
 */
export async function changeModel(
  transaction: ChatTransaction,
  session: Session,
  body: Record<string, unknown> | null,
  user: User,
  dependencies: ChatDependencies,
): Promise<ChangeModelResponse> {
  const next = dependencies.normalizeChoice(choice(body?.choice))
  const savedDraft = draft(body?.draft)
  const otherAgent = next.agent !== session.choice.agent
  if (!otherAgent || !(await transaction.newestTurn(session.id))) {
    session.choice = next
    if (otherAgent && session.startedBy)
      Object.assign(
        session,
        await SessionLogins.initial(
          dependencies,
          session.id,
          session.startedBy.id,
          next.agent,
        ),
      )
    await transaction.saveSession(session)
    await queueModel(transaction, session, dependencies.randomId())
    await transaction.emit({ type: 'session.updated', session })
    return {
      session,
      created: false,
      draft: savedDraft,
      eventNumber: transaction.eventNumber,
    }
  }
  const id = identifier(body?.newSessionId)
  const existing = await transaction.session(id)
  const creation = {
    sourceSessionId: session.id,
    requestedById: user.id,
    choice: next,
    draft: savedDraft,
  }
  if (existing) {
    const original = await transaction.modelSessionCreation(id)
    if (
      !original ||
      original.sourceSessionId !== creation.sourceSessionId ||
      original.requestedById !== user.id ||
      original.choice.agent !== next.agent ||
      original.choice.model !== next.model ||
      original.choice.effort !== next.effort ||
      (original.choice.fast ?? false) !== next.fast ||
      original.draft.text !== savedDraft.text ||
      JSON.stringify(original.draft.attachmentIds) !==
        JSON.stringify(savedDraft.attachmentIds)
    ) {
      throw new HttpError(
        409,
        'session_id_conflict',
        'Open a new session and try again.',
      )
    }
    return {
      session: existing,
      created: true,
      draft: savedDraft,
      eventNumber: transaction.eventNumber,
    }
  }
  const created = await createSession(transaction, next, id, user, dependencies)
  await transaction.saveModelSessionCreation(id, creation)
  return {
    session: created,
    created: true,
    draft: savedDraft,
    eventNumber: transaction.eventNumber,
  }
}
