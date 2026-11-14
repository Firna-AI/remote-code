import type { Attachment } from './generated/Attachment'
import { hasOwnWords, textWithAttachmentNames } from './attachment-mentions'

/**
 * A title for a session or workspace, or null when no own words remain.
 * It replaces mentions of its attached files with their original names.
 * It takes the first line with text and makes each run of spaces one space.
 * It removes one final full stop, but keeps an ellipsis. It cuts a line
 * over 60 Unicode code points at its last space within the limit, or at
 * the limit when the first word is longer.
 * The Worker, development page, and mockups share this rule, as
 * "Sessions" in `docs/protocol/agents-and-sessions.md` says.
 */
export function sessionTitleFrom(
  text: string,
  attachments: readonly Attachment[] = [],
): string | null {
  if (!hasOwnWords(text, attachments)) return null
  const line = textWithAttachmentNames(text, attachments)
    .trim()
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim()
  const title = withoutFinalFullStop(line)
  if (title === '') return null
  const points = Array.from(title)
  const limit = 60
  if (points.length <= limit) return title
  const boundary = points.lastIndexOf(' ', limit)
  return points.slice(0, boundary > 0 ? boundary : limit).join('')
}

export function modelTitleFrom(text: string): string | null {
  return sessionTitleFrom(text.replaceAll('_', ' '))
}

export function withoutFinalFullStop(text: string): string {
  return text.replace(/(?<!\.)\.$/, '').trimEnd()
}
