import type { Session } from '../../src/shared/generated/Session'
import type { UserMessage } from '../../src/shared/generated/UserMessage'

import { attachmentCopyKey } from './attachment-record'
import { normalizeSession, type StoredSession } from './session-storage'
import { CHAT_ROOT, chatKey } from './storage-keys'
import type { ChatData, ModelSessionCreation, StoredTurn } from './types'
import type { ToolSessionRequest } from './tool-session-requests'

const FIRST_SESSION_KEY = `${CHAT_ROOT}first-session`

interface FirstSession {
  id: string
  messageId?: string
}

export class ChatRecords {
  protected readonly data: ChatData

  constructor(data: ChatData) {
    this.data = data
  }

  firstSession(): Promise<FirstSession | undefined> {
    return this.data.get(FIRST_SESSION_KEY)
  }
  toolSessionRequest(id: string): Promise<ToolSessionRequest | undefined> {
    return this.data.get(chatKey('tool-session-request', id))
  }
  saveToolSessionRequest(
    id: string,
    request: ToolSessionRequest,
  ): Promise<void> {
    return this.data.put(chatKey('tool-session-request', id), request)
  }
  saveFirstSession(session: FirstSession): Promise<void> {
    return this.data.put(FIRST_SESSION_KEY, session)
  }

  async session(id: string): Promise<Session | undefined> {
    const stored = await this.data.get<StoredSession>(chatKey('session', id))
    if (!stored) return undefined
    const session = normalizeSession(stored)
    const active = session.activeTurnId
      ? await this.turn(session.activeTurnId)
      : undefined
    session.activeTurnStartedAt = active?.startedAt ?? null
    return session
  }

  async message(id: string): Promise<UserMessage | undefined> {
    const message = await this.data.get<UserMessage>(chatKey('message', id))
    return message
      ? {
          ...message,
          choice: { ...message.choice, fast: message.choice.fast ?? false },
        }
      : undefined
  }
  turn(id: string): Promise<StoredTurn | undefined> {
    return this.data.get(chatKey('turn', id))
  }
  messageTurn(id: string): Promise<string | undefined> {
    return this.data.get(chatKey('message-turn', id))
  }
  newestTurn(sessionId: string): Promise<string | undefined> {
    return this.data.get(chatKey('newest-turn', sessionId))
  }
  async sessions(): Promise<Session[]> {
    const records = await this.data.list<StoredSession>({
      prefix: `${CHAT_ROOT}session:`,
    })
    const sessions: Session[] = []
    for (const stored of records.values()) {
      const session = await this.session(stored.id)
      if (session) sessions.push(session)
    }
    return sessions
  }
  async turns(): Promise<StoredTurn[]> {
    return [
      ...(
        await this.data.list<StoredTurn>({ prefix: `${CHAT_ROOT}turn:` })
      ).values(),
    ]
  }
  async saveSession(session: Session): Promise<void> {
    const active = session.activeTurnId
      ? await this.turn(session.activeTurnId)
      : undefined
    session.activeTurnStartedAt = active?.startedAt ?? null
    await this.data.put(chatKey('session', session.id), session)
  }
  modelSessionCreation(id: string): Promise<ModelSessionCreation | undefined> {
    return this.data.get(chatKey('model-session', id))
  }
  saveModelSessionCreation(
    id: string,
    creation: ModelSessionCreation,
  ): Promise<void> {
    return this.data.put(chatKey('model-session', id), creation)
  }
  saveMessage(message: UserMessage): Promise<void> {
    return this.saveMessageWithAttachments(message)
  }
  private async saveMessageWithAttachments(
    message: UserMessage,
  ): Promise<void> {
    await this.data.put(chatKey('message', message.id), message)
    for (const attachment of message.attachments)
      await this.data.put(chatKey('attachment-use', attachment.id), {
        messageId: message.id,
        userId: message.sender.id,
      })
  }
  attachmentUse(
    id: string,
  ): Promise<{ messageId: string; userId: string } | undefined> {
    return this.data.get(chatKey('attachment-use', id))
  }
  async usedAttachments(
    ids: readonly string[],
    userId: string,
  ): Promise<string[]> {
    const used: string[] = []
    for (const id of ids)
      if ((await this.attachmentUse(id))?.userId === userId) used.push(id)
    return used
  }
  async attachmentCopy(messageId: string, sandboxId: string): Promise<boolean> {
    return (
      (await this.data.get<boolean>(
        chatKey(
          'attachment-copy',
          await attachmentCopyKey(messageId, sandboxId),
        ),
      )) === true
    )
  }
  async saveAttachmentCopy(
    messageId: string,
    sandboxId: string,
  ): Promise<void> {
    await this.data.put(
      chatKey('attachment-copy', await attachmentCopyKey(messageId, sandboxId)),
      true,
    )
  }
  messageSource(messageId: string): Promise<string | undefined> {
    return this.data.get(chatKey('message-source', messageId))
  }
  saveMessageSource(messageId: string, sessionId: string): Promise<void> {
    return this.data.put(chatKey('message-source', messageId), sessionId)
  }
}
