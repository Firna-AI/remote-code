import type { AgentSessionAccepted } from '../../src/shared/generated/AgentSessionAccepted'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { User } from '../../src/shared/api'

import type { SendMessageResponse } from '../../src/shared/messages'
import { sessionLink } from '../../src/shared/session-link'
import { sessionTitleFrom } from '../../src/shared/session-title'
import { configuredDefaultChoice } from '../app-api/models'
import { HttpError } from '../http'
import { hash } from '../security/crypto'
import type { AppEnv } from '../env'
import { agentToolMessage } from '../tools/message-text'
import { ownerPreference } from '../tools/store'
import type { ToolSessionWrite } from '../tools/services'
import { acceptMessage } from './messages'
import type { ChatOperation } from './operation'
import { send } from './send-message'
import { sessionFor } from './session-record'
import { createSession } from './sessions'
import type { ChatTransaction } from './store'
import type { ChatDependencies } from './types'

async function acceptance(
  transaction: ChatTransaction,
  response: SendMessageResponse,
): Promise<AgentSessionAccepted> {
  const turnId = await transaction.messageTurn(response.message.id)
  if (turnId === undefined)
    throw new HttpError(404, 'turn_not_found', 'The turn is not available.')
  return {
    ...response,
    turnId,
  }
}

export async function acceptToolSessionWrite(
  operation: ChatOperation,
  input: ToolSessionWrite,
  user: User,
  env: AppEnv,
  dependencies: ChatDependencies,
): Promise<AgentSessionAccepted> {
  const key = await hash(
    JSON.stringify([
      input.kind,
      input.callerWorkspaceId,
      input.callerSessionId,
      user.id,
      input.requestId,
    ]),
  )
  const fingerprint = await hash(
    JSON.stringify({
      kind: input.kind,
      input: { ...input.input, requestId: undefined },
    }),
  )
  const previous = await operation.read((view) => view.toolSessionRequest(key))
  if (previous) {
    if (
      previous.fingerprint !== fingerprint ||
      (input.kind === 'send' &&
        input.sessionId !== previous.requestedSessionId &&
        input.sessionId !== previous.accepted.session.id)
    )
      throw new HttpError(
        409,
        input.kind === 'send' ? 'message_id_conflict' : 'session_id_conflict',
        'Send the changed request with a new request ID.',
      )
    return previous.accepted
  }
  const defaults =
    input.kind === 'send'
      ? (await operation.read((view) => sessionFor(view, input.sessionId)))
          .choice
      : input.input.model && input.input.effort !== undefined
        ? null
        : ((await ownerPreference(env.DB, user.id)) ??
          configuredDefaultChoice(env))
  const model = input.input.model ?? defaults
  const effort = input.input.effort ?? defaults?.effort
  if (!model || effort === undefined)
    throw new HttpError(
      503,
      'default_model_unavailable',
      'The default model is not available. Choose a model and effort.',
    )
  const choice: AgentChoice = dependencies.normalizeChoice({
    ...model,
    effort,
    fast:
      input.input.fast ??
      (input.kind === 'send' ? (defaults?.fast ?? false) : false),
  })
  const text =
    input.kind === 'send' ? input.input.text : input.input.firstMessage
  const message =
    text === undefined
      ? null
      : {
          id: dependencies.randomId(),
          text: agentToolMessage(
            text,
            sessionLink(
              env.APP_ORIGIN,
              input.orgId,
              input.callerWorkspaceId,
              input.callerSessionId,
            ),
          ),
          choice,
          attachmentIds: [],
        }
  if (input.kind === 'send' && message) {
    const response = await send(
      operation,
      input.sessionId,
      message,
      user,
      dependencies,
      async (transaction, response) => {
        await transaction.saveToolSessionRequest(key, {
          fingerprint,
          requestedSessionId: input.sessionId,
          accepted: await acceptance(transaction, response),
        })
      },
    )
    return operation.read((view) => acceptance(view, response))
  }
  if (message) {
    const login = await operation.logins.forMember(user.id, choice.agent)
    if (!login || login.agent !== choice.agent)
      throw new HttpError(
        409,
        'agent_login_required',
        'Connect your agent login to send a message.',
      )
  }
  return operation.change(async (transaction) => {
    const session = await createSession(
      transaction,
      choice,
      dependencies.randomId(),
      user,
      dependencies,
    )
    const title =
      input.kind === 'create' && input.input.title !== undefined
        ? sessionTitleFrom(input.input.title)
        : null
    if (title !== null) {
      session.title = title
      await transaction.saveSession(session)
      await transaction.emit({ type: 'session.updated', session })
    }
    const accepted: AgentSessionAccepted = message
      ? await acceptance(
          transaction,
          await acceptMessage(
            transaction,
            session.id,
            message,
            user,
            { attachments: [], paths: [] },
            dependencies.randomId,
            dependencies.readAutomaticTitleWorkspace,
          ),
        )
      : {
          session,
          message: null,
          turnId: null,
          eventNumber: transaction.eventNumber,
        }
    await transaction.saveToolSessionRequest(key, { fingerprint, accepted })
    return accepted
  })
}
