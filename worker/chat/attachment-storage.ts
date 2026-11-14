import type { Attachment } from '../../src/shared/generated/Attachment'
import type { AttachmentUploadTarget } from '../../src/shared/messages'
import type { AppEnv } from '../env'
import { randomToken } from '../security/crypto'
import { warnWorker } from '../warnings'
import {
  insertAttachment,
  publishAttachment,
  readAttachment,
  saveAttachmentMultipart,
} from './attachment-data'
import { deleteAttachment } from './attachment-cleanup'
import { writeAttachmentObject } from './attachment-byte-storage'
import {
  ATTACHMENT_DRAFT_MS,
  attachmentBucket,
  attachmentNotFound,
  publicAttachment,
  type AttachmentRecord,
} from './attachment-record'

export interface AttachmentStorageInput {
  orgId: string
  uploaderUserId: string
  target: AttachmentUploadTarget
  name: string
  kind: 'image' | 'file'
  mediaType: string
}

/** Internal boundary. A browser adapter must authenticate metadata before calling it. */
export async function storeAttachment(
  env: AppEnv,
  input: AttachmentStorageInput,
  source: Uint8Array | ReadableStream<Uint8Array>,
  dependencies: {
    now: () => number
    newId: () => string
    byteLength?: number
    bodyComplete?: Promise<void>
  } = {
    now: Date.now,
    newId: randomToken,
  },
): Promise<Attachment> {
  const bucket = attachmentBucket(env)
  const id = dependencies.newId()
  const now = dependencies.now()
  const record: AttachmentRecord = {
    id,
    orgId: input.orgId,
    uploaderUserId: input.uploaderUserId,
    targetKind: input.target.type,
    targetId:
      input.target.type === 'workspace'
        ? input.target.workspaceId
        : input.target.messageId,
    name: input.name,
    kind: input.kind,
    mediaType: input.mediaType,
    sizeBytes: 0,
    objectKey: `attachments/${encodeURIComponent(input.orgId)}/${encodeURIComponent(id)}`,
    multipartId: null,
    state: 'uploading',
    createdAt: now,
    expiresAt: now + ATTACHMENT_DRAFT_MS,
    claimedWorkspaceId: null,
    claimedMessageId: null,
    revision: 0,
  }
  if (!(await insertAttachment(env.DB, record))) throw attachmentNotFound()
  try {
    record.sizeBytes = await writeAttachmentObject(
      bucket,
      record.objectKey,
      { attachmentId: id, orgId: input.orgId },
      source,
      async (multipartId) => {
        if (!(await saveAttachmentMultipart(env.DB, id, multipartId)))
          throw attachmentNotFound()
      },
      dependencies.byteLength,
    )
    await dependencies.bodyComplete
    if (
      !(await publishAttachment(
        env.DB,
        record,
        record.sizeBytes,
        dependencies.now(),
      ))
    )
      throw attachmentNotFound()
    return publicAttachment(record)
  } catch (error) {
    try {
      const current = await readAttachment(env.DB, id)
      if (current) await deleteAttachment(env, current)
      else await bucket.delete(record.objectKey)
    } catch {
      warnWorker({ kind: 'attachment_upload_cleanup_retry' })
    }
    throw error
  }
}
