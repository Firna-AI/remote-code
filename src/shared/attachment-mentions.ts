import type { Attachment } from './generated/Attachment'
import { mentionParts, type Mention } from './mention-text'

export function attachmentForMention(
  mention: Mention,
  attachments: readonly Attachment[],
): Attachment | undefined {
  return mention.folder
    ? undefined
    : attachments.find((file) => file.path === mention.path)
}

export function textWithAttachmentNames(
  text: string,
  attachments: readonly Attachment[],
  name: (value: string) => string = (value) => value,
): string {
  return mentionParts(text)
    .map((part) => {
      if (part.kind === 'text') return part.text
      const attachment = attachmentForMention(part, attachments)
      return attachment ? name(attachment.name) : part.source
    })
    .join('')
}

export function hasOwnWords(
  text: string,
  attachments: readonly Attachment[],
): boolean {
  return mentionParts(text).some((part) =>
    part.kind === 'text'
      ? part.text.trim() !== ''
      : attachmentForMention(part, attachments) === undefined,
  )
}
