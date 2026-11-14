import type { Attachment } from '../../shared/generated/Attachment'
import {
  ATTACHMENT_MAX_BYTES,
  attachmentUploadPath,
  type UploadAttachmentResponse,
} from '../../shared/messages'
import { attachmentPath } from '../../shared/attachment-paths'
import { ParseError } from '../api/parse'
import type { DevBackend } from './backend'
import { attachmentFiles } from './attachment-files'
import { ID, json, RouteError, type Route } from './router'

/**
 * What an upload of the dev fake does: `ready` answers at once, `wait`
 * never answers, so the file keeps uploading, and `fail` refuses the first
 * upload of the page once, so Try again then works.
 */
export type DevUploadMode = 'ready' | 'wait' | 'fail'

/** A query value that holds more than spaces, as the Worker requires. */
function required(query: URLSearchParams, key: string): string {
  const value = query.get(key)?.trim() ?? ''
  if (value === '') throw new ParseError(`${key} is empty.`)
  return value
}

/**
 * The upload routes of the dev fake, for the files of a workspace message
 * and of the first message of a new workspace. Each takes the raw file of
 * the app's upload operation, with its name and its media type in the
 * query. The state keeps each upload, so a create can name its files.
 */
export function attachmentRoutes(
  backend: DevBackend,
  mode: DevUploadMode,
): Route[] {
  let failed = false
  const upload = async (
    query: URLSearchParams,
    body: unknown,
  ): Promise<Response> => {
    if (!(body instanceof ArrayBuffer)) throw new ParseError('No file.')
    const name = required(query, 'name')
    const mediaType = required(query, 'mediaType')
    if (body.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new RouteError(
        413,
        'attachment_too_large',
        'Each file can be up to 100 MB.',
      )
    }
    if (mode === 'wait') return new Promise<Response>(() => {})
    if (mode === 'fail' && !failed) {
      failed = true
      throw new RouteError(502, 'upload_failed', 'The upload failed.')
    }
    const file = { id: backend.newId(), name }
    const attachment: Attachment = {
      ...file,
      path: await attachmentPath(file),
      kind: mediaType.startsWith('image/') ? 'image' : 'file',
      mediaType,
      sizeBytes: body.byteLength,
    }
    backend.state.attachments.set(attachment.id, attachment)
    attachmentFiles(backend).retain(attachment, body)
    return json({ attachment } satisfies UploadAttachmentResponse, 201)
  }
  const targets = [
    { type: 'workspace', workspaceId: ID.workspace },
    { type: 'new-workspace', messageId: '' },
  ] as const
  return targets.map((target): Route => ({
    method: 'POST',
    path: attachmentUploadPath(ID.org, target),
    answer: ({ query, body }) => upload(query, body),
  }))
}
