import type { Attachment } from '../../shared/generated/Attachment'
import type { SendMessageRequest } from '../../shared/messages'
import { withSession, type PendingMessage } from './chat-snapshot'
import type { ChatContext } from './context'
import { takeReply } from './linked-replies'

/** The title of the notice of a message that did not send. */
export const sendFailedTitle = "Your message didn't send"

/** A posted message: the session that took it, or the error of the send. */
export type PostedMessage = { target: string | null } | { error: unknown }

/**
 * Posts one message of a session, the step that a draft and a fixed prompt
 * share. The message shows in the session at once, below the transcript,
 * and its send waits for the reply there. The reply goes to the session that
 * it names, as `takeReply` says, and takes the place of the message that
 * waited. A reply can name a linked session that the Worker opened, because
 * the login of the starter was not available. Then the waiting message
 * leaves the session of the request. A failed send takes the message out of
 * the chat, so the caller can give it back to the user.
 */
export async function postMessage(
  context: ChatContext,
  sessionId: string,
  request: SendMessageRequest,
  attachments: readonly Attachment[],
): Promise<PostedMessage> {
  showWaiting(context, sessionId, {
    id: request.id,
    text: request.text,
    attachments,
    state: 'queued',
  })
  try {
    const target = takeReply(
      context,
      await context.api.send(sessionId, request),
    )
    if (target !== sessionId) dropWaiting(context, sessionId, request.id)
    return { target }
  } catch (error) {
    dropWaiting(context, sessionId, request.id)
    return { error }
  }
}

/**
 * Shows a message of this tab as waiting in its session, and puts the kept
 * place of the session at the bottom. So the message shows when the session
 * shows again, also when the send came while a file tab showed, such as a
 * fixed prompt of the pull request bar.
 */
function showWaiting(
  context: ChatContext,
  sessionId: string,
  message: PendingMessage,
): void {
  context.store.places.set(sessionId, { kind: 'bottom' })
  if (!context.live()) return
  context.store.update((snapshot) =>
    withSession(snapshot, sessionId, (state) => {
      const known =
        state.pending.some((item) => item.id === message.id) ||
        state.transcript.items.some((item) => item.id === `user:${message.id}`)
      return known ? state : { ...state, pending: [...state.pending, message] }
    }),
  )
}

function dropWaiting(
  context: ChatContext,
  sessionId: string,
  messageId: string,
): void {
  if (!context.live()) return
  context.store.update((snapshot) =>
    withSession(snapshot, sessionId, (state) => ({
      ...state,
      pending: state.pending.filter((item) => item.id !== messageId),
    })),
  )
}
