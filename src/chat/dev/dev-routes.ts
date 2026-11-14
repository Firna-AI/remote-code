import type { Session } from '../../shared/generated/Session'
import type { Attachment } from '../../shared/generated/Attachment'
import type { UserMessage } from '../../shared/generated/UserMessage'
import { filePaths } from '../../shared/files'
import { attachmentFiles, readCopiedFile } from '../../app/dev/attachment-files'
import { attachmentPath } from '../../shared/attachment-paths'
import { sessionsPath } from '../../shared/sessions'
import { workspaceViewPath } from '../../shared/workspace-view'
import { workspacePaths } from '../../shared/workspaces'
import { list, record, text } from '../api/json'
import { readAttachment, readChoice } from '../api/read-chat'
import type { DevBackend } from './dev-backend'
import { requestStop, resume } from './dev-sandbox'
import {
  askTitle,
  clearRetry,
  newSession,
  place,
  recordOf,
  targetOf,
  titleFromMessage,
} from './dev-sessions'

const reply = (body: unknown, status = 200) => Response.json(body, { status })

/** A session reply, with the number of the last event, as the Worker's. */
const recordReply = (backend: DevBackend, body: object, status = 200) =>
  reply({ ...body, eventNumber: backend.stream.last }, status)

/** The Worker's answer to a retry of a message that the record does not name. */
const RETRY_REFUSED = {
  error: {
    code: 'retry_not_available',
    message:
      'Only the newest failed request can run again. Send a new message.',
  },
}

/** A message as a send gives it, before the page accepts it. */
type Outgoing = Pick<UserMessage, 'id' | 'text' | 'attachments' | 'choice'>

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.clone().json()
  return record(value)
}

const attachments = new Map<string, Attachment>()

async function send(backend: DevBackend, session: Session, request: Request) {
  const body = await bodyOf(request)
  return accept(backend, targetOf(backend, session), {
    id: text(body.id),
    text: text(body.text),
    attachments: list(text)(body.attachmentIds).flatMap(
      (id) => attachments.get(id) ?? [],
    ),
    choice: readChoice(body.choice),
  })
}

/**
 * Accepts a message of the reader, as the Worker does: it steers the running
 * turn, waits for the sandbox, or starts a turn. The session then names no
 * retry, and a later session can take its title from the message. A new
 * workspace with no title yet asks for it. The reply names the session that
 * took the message, with its record.
 */
function accept(backend: DevBackend, session: Session, outgoing: Outgoing) {
  const ready = ['ready', 'working', 'input', 'unread'].includes(
    backend.workspace.state,
  )
  const message: UserMessage = {
    ...outgoing,
    sessionId: session.id,
    sender: backend.viewer,
    createdAt: backend.clock.now(),
    state: ready ? 'sent' : 'queued',
  }
  if (ready)
    attachmentFiles(backend).copy(
      backend.target.orgId,
      backend.target.workspaceId,
      message.attachments,
    )
  backend.messages.set(message.id, message)
  const steered = backend.agent.steer(message)
  if (!steered) backend.stream.emit({ type: 'message.accepted', message })
  clearRetry(backend, session.id)
  titleFromMessage(backend, message)
  askTitle(backend, message)
  const answer = (turnId: string | null) =>
    recordReply(
      backend,
      { message, turnId, session: recordOf(backend, session.id) ?? session },
      202,
    )
  if (steered) return answer(steered)
  const recorded = backend.recordedTurns.get(session.id)
  if (recorded) {
    backend.stream.emit({
      type: 'message.sent',
      sessionId: session.id,
      messageId: message.id,
      turnId: recorded,
    })
    return answer(recorded)
  }
  if (!ready) {
    backend.queue.push(message)
    return answer(null)
  }
  return answer(backend.agent.start(session.id, [message]))
}

async function sessionWrite(
  backend: DevBackend,
  request: Request,
  session: Session,
  action: string,
  messageId: string | undefined,
): Promise<Response | null> {
  const { method } = request
  const running =
    backend.agent.running(session.id) ?? backend.recordedTurns.get(session.id)
  if (method === 'PATCH' && action === '') {
    const title = text((await bodyOf(request)).title)
    place(backend, { ...session, title })
    return recordReply(backend, { session: { ...session, title } })
  }
  if (method === 'POST' && action === 'close') {
    if ((await bodyOf(request)).stopRunningTurn === true)
      requestStop(backend, session.id)
    const closed = {
      ...(recordOf(backend, session.id) ?? session),
      closedAt: backend.clock.now(),
      activeTurnId: null,
      activeTurnStartedAt: null,
    }
    place(backend, closed)
    return recordReply(backend, { session: closed })
  }
  if (method === 'POST' && action === 'reopen') {
    const reopened = { ...session, closedAt: null }
    place(backend, reopened)
    return recordReply(backend, { session: reopened })
  }
  if (method === 'POST' && action === 'messages')
    return send(backend, session, request)
  if (method === 'POST' && action === 'interrupt' && running) {
    requestStop(backend, session.id)
    return recordReply(backend, { turnId: running, state: 'stopping' })
  }
  if (method === 'POST' && action === 'retry' && messageId) {
    // As the Worker does, a retry sends the named message again as a new one.
    const previous = backend.messages.get(messageId)
    if (!previous) return null
    if (session.retryMessageId !== messageId) return reply(RETRY_REFUSED, 409)
    backend.count += 1
    return accept(backend, targetOf(backend, session), {
      id: `dev-retry-${backend.count}`,
      text: previous.text,
      attachments: previous.attachments,
      choice: previous.choice,
    })
  }
  if (method === 'PUT' && action === 'model') {
    const body = await bodyOf(request)
    const choice = readChoice(body.choice)
    // As the Worker does, a session with no message keeps another agent too.
    const used = [...backend.messages.values()].some(
      (message) => message.sessionId === session.id,
    )
    if (choice.agent === session.choice.agent || !used) {
      place(backend, { ...session, choice })
      return recordReply(backend, {
        session: { ...session, choice },
        created: false,
        draft: body.draft,
      })
    }
    const id = text(body.newSessionId)
    const known = [...backend.open, ...backend.closed].find(
      (item) => item.id === id,
    )
    const opened = known ?? newSession(backend, choice, { id })
    return recordReply(backend, {
      session: opened,
      created: true,
      draft: body.draft,
    })
  }
  return null
}

/**
 * The writes that the development page makes stateful. Each one changes the
 * fake's records, and sends the events that the backend would send.
 */
export async function handleWrite(
  backend: DevBackend,
  request: Request,
): Promise<Response | null> {
  const { orgId, workspaceId } = backend.target
  const path = new URL(request.url).pathname
  const { method } = request
  if (method === 'GET') return readCopiedFile(backend, backend.target, request)
  if (method === 'POST' && path === sessionsPath(orgId, workspaceId)) {
    const choice = readChoice((await bodyOf(request)).choice)
    return recordReply(backend, { session: newSession(backend, choice) }, 201)
  }
  if (method === 'PUT' && path === workspaceViewPath(orgId, workspaceId)) {
    const view = await bodyOf(request)
    backend.server.json('GET', workspaceViewPath(orgId, workspaceId), { view })
    return reply({ view })
  }
  if (method === 'POST' && path === workspacePaths.resume(orgId, workspaceId)) {
    return reply(resume(backend))
  }
  if (method === 'POST' && path === filePaths.attachments(orgId, workspaceId)) {
    const query = new URL(request.url).searchParams
    const mediaType = text(query.get('mediaType'))
    const file = {
      id: `dev-file-${attachments.size + 1}`,
      name: text(query.get('name')),
    }
    const path = await attachmentPath(file)
    const bytes = await request.arrayBuffer()
    const attachment = readAttachment({
      ...file,
      path,
      kind: mediaType.startsWith('image/') ? 'image' : 'file',
      mediaType,
      sizeBytes: bytes.byteLength,
    })
    attachments.set(attachment.id, attachment)
    attachmentFiles(backend).retain(attachment, bytes)
    return reply({ attachment }, 201)
  }
  const prefix = `${sessionsPath(orgId, workspaceId)}/`
  if (!path.startsWith(prefix)) return null
  const [id = '', action = '', messageId, retry] = path
    .slice(prefix.length)
    .split('/')
    .map(decodeURIComponent)
  const session = [...backend.open, ...backend.closed].find(
    (item) => item.id === id,
  )
  if (!session) return null
  return sessionWrite(backend, request, session, retry ?? action, messageId)
}
