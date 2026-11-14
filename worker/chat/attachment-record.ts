import type { Attachment } from '../../src/shared/generated/Attachment'
import { attachmentPath } from '../../src/shared/attachment-paths'
import type { AppEnv } from '../env'
import { HttpError } from '../http'
import { hash } from '../security/crypto'

export const ATTACHMENT_DRAFT_MS = 7 * 24 * 60 * 60 * 1_000

export interface AttachmentRecord {
  id: string
  orgId: string
  uploaderUserId: string
  targetKind: 'workspace' | 'new-workspace'
  targetId: string
  name: string
  kind: 'image' | 'file'
  mediaType: string
  sizeBytes: number
  objectKey: string
  multipartId: string | null
  state: 'uploading' | 'ready' | 'claimed' | 'deleting'
  createdAt: number
  expiresAt: number
  claimedWorkspaceId: string | null
  claimedMessageId: string | null
  revision: number
}

export function attachmentNotFound(): HttpError {
  return new HttpError(
    404,
    'attachment_not_found',
    'The attached file is not available. Upload it again.',
  )
}

export function attachmentTooLarge(): HttpError {
  return new HttpError(
    413,
    'attachment_too_large',
    'Each file can be up to 100 MB.',
  )
}

export function attachmentBucket(env: AppEnv): R2Bucket {
  if (!env.CHAT_ATTACHMENTS)
    throw new HttpError(
      503,
      'attachments_unavailable',
      'Attachments are not available. Try again.',
    )
  return env.CHAT_ATTACHMENTS
}

export async function publicAttachment(
  record: AttachmentRecord,
): Promise<Attachment & { path: string }> {
  return {
    id: record.id,
    name: record.name,
    path: await attachmentPath(record),
    kind: record.kind,
    mediaType: record.mediaType,
    sizeBytes: record.sizeBytes,
  }
}

export function attachmentCopyKey(
  messageId: string,
  sandboxId: string | null,
): Promise<string> {
  return hash(JSON.stringify([messageId, sandboxId]))
}
