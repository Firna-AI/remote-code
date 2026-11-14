import type { Attachment } from '../../shared/generated/Attachment'
import {
  filesWait,
  isMissingFile,
  readyIds,
  stopFile,
  type DraftFile,
} from '../../app/draft-files'
import {
  failSentDraft,
  markedFiles,
  messageText,
  reconcileFiles,
} from '../../app/draft-file-state'
import { withoutMarks } from '../../app/draft-marks'
import type { SendMessageRequest } from '../../shared/messages'
import { sendBlock } from './blockers'
import { sessionState, withSession, type SessionState } from './chat-snapshot'
import { showNotice, type ChatContext } from './context'
import {
  afterSend,
  changeDraft,
  draftIdOf,
  failSend,
  holderOf,
  startSend,
} from './drafts'
import { resumeFiles } from './attachment-actions'
import { showTarget, takeReply } from './linked-replies'
import { postMessage, sendFailedTitle } from './message-send'
import { confirmWorkspace } from './workspace-records'

function change(
  context: ChatContext,
  sessionId: string,
  update: (state: SessionState) => SessionState,
): void {
  if (!context.live()) return
  context.store.update((snapshot) => withSession(snapshot, sessionId, update))
}

export function setDraftText(
  context: ChatContext,
  sessionId: string,
  text: string,
): void {
  if (!context.live()) return
  const draftId = draftIdOf(context, sessionId)
  const { draft } = sessionState(context.store.get(), sessionId)
  const next = reconcileFiles(draft, text)
  for (const item of draft.files) {
    if (!next.files.some(({ id }) => id === item.id))
      stopFile(context.uploads, item.id)
  }
  changeDraft(context, draftId, (current) => ({
    ...current,
    ...next,
    text,
    sendId: null,
  }))
  resumeFiles(
    context,
    draftId,
    next.files.filter(
      (item) =>
        item.state === 'uploading' &&
        draft.detached.some(({ id }) => id === item.id),
    ),
  )
}

/**
 * Sends the draft of a session. The message leaves the composer and shows in
 * the chat at once, while its send waits. The workspace queues messages
 * during its first start, after a failed first start, and during Resume.
 * During a turn, a message steers the agent. Send waits while a file uploads
 * or has failed. It sends only the IDs of ready files. A failed send gives
 * the message back to its draft with its client ID, so Send again is the same
 * message, as `failSend` says.
 *
 * When the server no longer has a file, that file turns failed. Try again
 * uploads its kept File. The send finishes on its draft, also after a move
 * to another session. A linked-session reply shows its message in that
 * session, and the sending tab shows that session, as `linked-replies.ts`
 * says.
 */
export async function sendDraft(
  context: ChatContext,
  sessionId: string,
): Promise<void> {
  const snapshot = context.store.get()
  const session = snapshot.sessions.find((item) => item.id === sessionId)
  const { draft } = sessionState(snapshot, sessionId)
  const files = markedFiles(draft.text, draft.files)
  const empty = withoutMarks(draft.text).trim() === '' && files.length === 0
  const busy = draft.sending || filesWait(files)
  if (!session || busy || empty || sendBlock(snapshot, sessionId)) return
  const request: SendMessageRequest = {
    id: draft.sendId ?? context.newId(),
    text: messageText(draft.text, files),
    attachmentIds: readyIds(files),
    choice: session.choice,
  }
  const draftId = draftIdOf(context, sessionId)
  changeDraft(context, draftId, (current) => startSend(current, request))
  const posted = await postMessage(
    context,
    sessionId,
    request,
    readyAttachments(files),
  )
  if ('error' in posted) {
    const { error } = posted
    const holder = holderOf(context.store.get(), draftId) ?? sessionId
    changeDraft(context, draftId, (current) => {
      const back = failSend(current, {
        sent: draft,
        sendId: request.id,
        sameSession: holder === sessionId,
      })
      return isMissingFile(error)
        ? { ...back, ...failSentDraft(back, request.attachmentIds, error) }
        : back
    })
    showNotice(context, holder, sendFailedTitle, error)
    return
  }
  changeDraft(context, draftId, afterSend)
  const holder = holderOf(context.store.get(), draftId)
  const owner = context.store.get().notice?.sessionId
  if (context.live() && owner && (owner === sessionId || owner === holder)) {
    context.store.update((current) => ({ ...current, notice: null }))
  }
  await showTarget(context, sessionId, posted.target, draftId)
}

/** The attachments of the ready files, which show with a message. */
function readyAttachments(files: readonly DraftFile[]): Attachment[] {
  return files.flatMap((item) =>
    item.state === 'ready' ? [item.attachment] : [],
  )
}

/**
 * Try again sends the message of a failed turn again. The stream shows a
 * retry in the same session. A reply that names a linked session shows its
 * message there, as a send does.
 */
export async function retryTurn(
  context: ChatContext,
  sessionId: string,
  messageId: string,
): Promise<void> {
  const draftId = draftIdOf(context, sessionId)
  change(context, sessionId, (state) => ({ ...state, retrying: true }))
  let target: string | null = null
  try {
    const reply = await context.api.retry(sessionId, messageId)
    if (reply.message.sessionId !== sessionId) {
      target = takeReply(context, reply)
    }
  } catch (error) {
    showNotice(context, sessionId, "The turn didn't restart", error)
  }
  change(context, sessionId, (state) => ({ ...state, retrying: false }))
  await showTarget(context, sessionId, target, draftId)
}

/**
 * Stop interrupts the running turn: the one that the transcript shows, from
 * its events and the records of its session. The turn shows as stopped when
 * it ends.
 */
export async function interruptTurn(
  context: ChatContext,
  sessionId: string,
): Promise<void> {
  const state = sessionState(context.store.get(), sessionId)
  const turnId = state.transcript.turn?.turnId
  if (!turnId || state.stopping) return
  change(context, sessionId, (current) => ({ ...current, stopping: true }))
  try {
    await context.api.interrupt(sessionId, turnId)
  } catch (error) {
    change(context, sessionId, (current) => ({ ...current, stopping: false }))
    showNotice(context, sessionId, "The agent didn't stop", error)
  }
}

/**
 * Resume, or Try again after a failed start, starts the sandbox. Its reply
 * shows the workspace and the start steps only while no newer state of them
 * came by event number, and the button is free again in every case.
 */
export async function resumeWorkspace(context: ChatContext): Promise<void> {
  if (context.store.get().resuming) return
  context.store.update((snapshot) => ({ ...snapshot, resuming: true }))
  try {
    confirmWorkspace(context, await context.api.resume())
  } catch (error) {
    showNotice(context, null, "The sandbox didn't start", error)
  } finally {
    if (context.live()) {
      context.store.update((snapshot) => ({ ...snapshot, resuming: false }))
    }
  }
}
