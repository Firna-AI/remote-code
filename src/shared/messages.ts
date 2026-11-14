import type { Session } from './generated/Session'
import type { AgentChoice } from './generated/AgentChoice'
import type { UserMessage } from './generated/UserMessage'
import type { Attachment } from './generated/Attachment'
import { orgPath } from './api'

import { filePaths } from './files'

export const ATTACHMENT_MAX_BYTES = 100_000_000

export type AttachmentUploadTarget =
  | { type: 'workspace'; workspaceId: string }
  | { type: 'new-workspace'; messageId: string }

function draftAttachmentsPath(orgId: string): string {
  return `${orgPath(orgId)}/attachments`
}

export function attachmentUploadPath(
  orgId: string,
  target: AttachmentUploadTarget,
): string {
  return target.type === 'workspace'
    ? filePaths.attachments(orgId, target.workspaceId)
    : draftAttachmentsPath(orgId)
}

export function attachmentUploadUrl(
  orgId: string,
  target: AttachmentUploadTarget,
  metadata: { name: string; mediaType: string },
): string {
  const query = new URLSearchParams(metadata)
  if (target.type === 'new-workspace') query.set('messageId', target.messageId)
  return `${attachmentUploadPath(orgId, target)}?${query}`
}

export interface MessageDraft {
  text: string
  attachmentIds: readonly string[]
}

export interface SendMessageRequest extends MessageDraft {
  /** A stable client ID lets a retry refer to the same message. */
  id: string
  choice: AgentChoice
}

export interface SendMessageResponse {
  eventNumber: number
  message: UserMessage
  turnId: string | null
  session: Session
}

export interface UploadAttachmentResponse {
  attachment: Attachment
}
