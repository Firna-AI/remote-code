import type { UserMessage } from '../../src/shared/generated/UserMessage'
import type { User } from '../../src/shared/api'
import type {
  SendMessageRequest,
  SendMessageResponse,
} from '../../src/shared/messages'
import { applyMessageSessionTitle } from './session-titles'
import { HttpError } from '../http'
import { sessionFor } from './session-record'
import { queueModel, sameAgent } from './sessions'
import type { ChatTransaction } from './store'
import { TurnLifecycle } from './turn-lifecycle'
import type { ChatDependencies, ResolvedAttachments, StoredTurn } from './types'

export async function existingMessage(
  transaction: ChatTransaction,
  sessionId: string,
  input: SendMessageRequest,
  user: User,
): Promise<SendMessageResponse | null> {
  const existing = await transaction.message(input.id)
  if (!existing) return null
  if (
    (existing.sessionId !== sessionId &&
      (await transaction.messageSource(input.id)) !== sessionId) ||
    existing.sender.id !== user.id ||
    existing.text !== input.text ||
    existing.choice.agent !== input.choice.agent ||
    existing.choice.model !== input.choice.model ||
    existing.choice.effort !== input.choice.effort ||
    (existing.choice.fast ?? false) !== input.choice.fast ||
    JSON.stringify(existing.attachments.map((attachment) => attachment.id)) !==
      JSON.stringify(input.attachmentIds)
  ) {
    throw new HttpError(
      409,
      'message_id_conflict',
      'Send the changed message with a new message ID.',
    )
  }
  return responseFor(transaction, existing)
}

async function responseFor(
  transaction: ChatTransaction,
  message: UserMessage,
): Promise<SendMessageResponse> {
  const turnId = await transaction.messageTurn(message.id)
  const turn = turnId ? await transaction.turn(turnId) : undefined
  return {
    eventNumber: transaction.eventNumber,
    message,
    turnId: turn && turn.state !== 'queued' ? turn.id : null,
    session: await sessionFor(transaction, message.sessionId),
  }
}

export async function acceptMessage(
  transaction: ChatTransaction,
  sessionId: string,
  input: SendMessageRequest,
  user: User,
  attachments: ResolvedAttachments,
  randomId: () => string,
  readWorkspace: ChatDependencies['readAutomaticTitleWorkspace'],
): Promise<SendMessageResponse> {
  const existing = await existingMessage(transaction, sessionId, input, user)
  if (existing) return existing
  const session = await sessionFor(transaction, sessionId)
  sameAgent(session, input.choice)
  if (session.closedAt !== null) {
    throw new HttpError(
      409,
      'session_closed',
      'Reopen the session to send a message.',
    )
  }
  await applyMessageSessionTitle(
    transaction,
    session,
    input.text,
    attachments.attachments,
    readWorkspace,
  )
  const message: UserMessage = {
    id: input.id,
    sessionId,
    text: input.text,
    sender: {
      id: user.id,
      githubLogin: user.githubLogin,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
    attachments: attachments.attachments,
    choice: input.choice,
    createdAt: transaction.now,
    state: 'queued',
  }
  await transaction.saveMessage(message)
  const changed =
    session.choice.model !== input.choice.model ||
    session.choice.effort !== input.choice.effort ||
    session.choice.fast !== input.choice.fast
  session.choice = input.choice
  if (changed) await queueModel(transaction, session, randomId())
  const turn = await new TurnLifecycle(transaction, session).select(
    user.id,
    randomId,
  )
  session.retryMessageId = null
  await transaction.saveNewestTurn(sessionId, turn.id)
  const type = turn.messageIds.length === 0 ? 'turn' : 'message'
  turn.messageIds.push(message.id)
  await transaction.saveTurn(turn)
  await transaction.saveMessageTurn(message.id, turn.id)
  await transaction.saveCommand({
    type,
    commandId: randomId(),
    sessionId,
    turnId: turn.id,
    messageId: message.id,
    attachments: attachments.paths,
  })
  await transaction.emit({ type: 'message.accepted', message })
  await transaction.saveSession(session)
  await transaction.emit({ type: 'session.updated', session })
  return responseFor(transaction, message)
}

export async function markSent(
  transaction: ChatTransaction,
  turn: StoredTurn,
  messageId: string,
): Promise<void> {
  const message = await transaction.message(messageId)
  if (
    !message ||
    message.sessionId !== turn.sessionId ||
    !turn.messageIds.includes(messageId)
  ) {
    throw new HttpError(
      400,
      'runner_message_mismatch',
      'The message is not available.',
    )
  }
  if (message.state === 'sent') return
  message.state = 'sent'
  await transaction.saveMessage(message)
  await transaction.emit({
    type: 'message.sent',
    sessionId: turn.sessionId,
    messageId,
    turnId: turn.id,
  })
}
