import type { UserMessage } from '../../shared/generated/UserMessage'
import { readSendResponse } from '../../chat/api/read-responses'
import type {
  SendMessageRequest,
  SendMessageResponse,
} from '../../shared/messages'
import { sessionPaths } from '../../shared/sessions'
import { FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { senderSnapshot } from '../../test-support/fixtures/workspaces'
import type { FetchLike } from '../api/client'
import { nested, record, text, texts } from '../api/parse'
import { readChoice } from '../api/read-core'
import { attachmentFiles } from './attachment-files'
import { requireOrg, requireWorkspace, type DevBackend } from './backend'
import { ID, json, match } from './router'

/** Attachment sends keep the recorded session reply and the caller's files. */
export function attachmentMessageFetch(
  backend: DevBackend,
  fallback: FetchLike,
): FetchLike {
  return async (input, init) => {
    const request = new Request(new URL(input, FAKE_ORIGIN), init)
    const params =
      request.method === 'POST'
        ? match(
            sessionPaths.messages(ID.org, ID.workspace, ':session'),
            new URL(request.url).pathname,
          )
        : null
    if (!params) return fallback(input, init)
    let outgoing: SendMessageRequest
    try {
      const body: unknown = await request.json()
      const fields = record(body)
      outgoing = {
        id: text(fields, 'id'),
        text: text(fields, 'text'),
        attachmentIds: texts(fields, 'attachmentIds'),
        choice: nested(fields, 'choice', readChoice),
      }
    } catch {
      return fallback(input, init)
    }
    const attachments = outgoing.attachmentIds.flatMap(
      (id) => backend.state.attachments.get(id) ?? [],
    )
    if (attachments.length === 0) return fallback(input, init)
    const workspace = requireWorkspace(
      requireOrg(backend.state, params.org),
      params.workspace,
    )
    if (workspace.state === 'archived') return fallback(input, init)
    const response = await fallback(input, init)
    if (!response.ok) return response
    const value: unknown = await response.json()
    const recorded = readSendResponse(value)
    const ready = ['ready', 'working', 'input', 'unread'].includes(
      workspace.state,
    )
    const message: UserMessage = {
      ...recorded.message,
      id: outgoing.id,
      text: outgoing.text,
      attachments,
      choice: outgoing.choice,
      sender: senderSnapshot(backend.state.account.user),
      createdAt: backend.now(),
      state: ready ? 'sent' : 'queued',
    }
    if (ready)
      attachmentFiles(backend).copy(params.org, params.workspace, attachments)
    return json(
      {
        ...recorded,
        message,
        turnId: ready ? recorded.turnId : null,
      } satisfies SendMessageResponse,
      response.status,
    )
  }
}
