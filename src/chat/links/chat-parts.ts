import type { FileEntry } from '../../shared/generated/FileEntry'
import type { Attachment } from '../../shared/generated/Attachment'
import { attachmentForMention } from '../../shared/attachment-mentions'
import { mentionAt, type Mention } from '../../shared/mention-text'
import {
  bareLinkAt,
  linkTarget,
  markdownTargetAt,
  type LinkTarget,
  type WorkspaceLinks,
} from './workspace-links'

/** A part of a sent message or of an answer, as the chat shows it. */
export type ChatPart =
  | { kind: 'text'; text: string; strong: boolean }
  | { kind: 'code'; text: string }
  | { kind: 'chip'; source: string; target: LinkTarget; strong: boolean }
  | { kind: 'file'; source: string; entry: FileEntry; strong: boolean }
  | AttachmentPart

/**
 * The mention of a file of the message, which shows as the chip of the
 * file. `path` is the copy path of the file that the mention names.
 */
export type AttachmentPart = {
  kind: 'attachment'
  source: string
  path: string
  attachment: Attachment
  strong: boolean
}

/** A token of chat text, before the list of the org names its links. */
type Token =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'mark' }
  | { kind: 'link'; href: string; source: string; markdown: boolean }
  | { kind: 'mention'; mention: Mention }

/** What a reading of chat text looks for, besides code. */
interface Reading {
  /** `**` marks bold, as in an answer. */
  marks: boolean
  /** Links count. A Markdown link of no workspace reads again without them. */
  links: boolean
  /**
   * Whether a mention counts, as in a message of a member. The `@` of each
   * other mention reads as plain text.
   */
  mentions: (mention: Mention) => boolean
}

/** Finds the entry of the file tree that a mention names. */
export type MentionLookup = (mention: Mention) => FileEntry | undefined

/**
 * The Markdown link whose `[` stands at `at`, or null. Its label ends at the
 * first `]` outside code, on the same line, and its target follows at once.
 * So a label can hold code or bold.
 */
function markdownLinkAt(text: string, at: number): Token | null {
  let code = false
  for (let index = at + 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\n') return null
    if (char === '`') code = !code
    else if (char === ']' && !code) {
      const target = markdownTargetAt(text, index + 1)
      if (!target) return null
      const source = text.slice(at, index + 1 + target.length)
      return { kind: 'link', href: target.href, source, markdown: true }
    }
  }
  return null
}

/**
 * The bare web address at `at`, or null. Where `**` marks bold, the address
 * ends before the next mark, so bold around the address stays bold.
 */
function bareLinkTokenAt(
  text: string,
  at: number,
  marks: boolean,
): Token | null {
  const mark = marks ? text.indexOf('**', at) : -1
  const href = bareLinkAt(mark === -1 ? text : text.slice(0, mark), at)
  return href ? { kind: 'link', href, source: href, markdown: false } : null
}

/**
 * The tokens of a chat text, from left to right. A backtick starts code,
 * which runs to the next backtick, or to the end of the text. Outside code,
 * a Markdown link, a bare web address, and a `**` mark each start where
 * they stand, so code and bold in a link label stay in the link.
 */
function tokens(text: string, reading: Reading): Token[] {
  const found: Token[] = []
  let plain = ''
  const add = (token: Token, length: number) => {
    if (plain !== '') found.push({ kind: 'text', text: plain })
    plain = ''
    found.push(token)
    return length
  }
  let index = 0
  while (index < text.length) {
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1)
      const close = end === -1 ? text.length : end
      const code = text.slice(index + 1, close)
      index += add({ kind: 'code', text: code }, close + 1 - index)
      continue
    }
    if (reading.marks && text.startsWith('**', index)) {
      index += add({ kind: 'mark' }, 2)
      continue
    }
    const mention = mentionAt(text, index)
    if (mention && reading.mentions(mention)) {
      index += add({ kind: 'mention', mention }, mention.source.length)
      continue
    }
    const link = !reading.links
      ? null
      : text[index] === '['
        ? markdownLinkAt(text, index)
        : text.startsWith('http', index)
          ? bareLinkTokenAt(text, index, reading.marks)
          : null
    if (link?.kind === 'link') {
      index += add(link, link.source.length)
      continue
    }
    plain += text[index]
    index += 1
  }
  if (plain !== '') found.push({ kind: 'text', text: plain })
  return found
}

/**
 * Splits a sent message or an answer into text, code, and chips, with one
 * reading for both. Code comes first, so a link in code stays code. A
 * Markdown link whose brackets stand outside code is one unit, also when
 * its label holds code or bold: it shows as its chip alone when it names a
 * workspace of the list. Each other link shows its source as before: a
 * Markdown link with the code and the bold of its source. With `strong`,
 * as in an answer, `**` marks bold around text and chips. Bold ends at
 * code, as it did before. With `mentions`, as in a message of a member,
 * each mention of an entry of the file tree is a file chip, and each other
 * mention stays text. `attachments` are the files of a sent message: each
 * mention of the copy path of one of them is the chip of that file, before
 * an entry of the tree, also in a chat without a tree.
 */
export function chatParts(
  text: string,
  links: WorkspaceLinks,
  options: {
    strong: boolean
    mentions?: MentionLookup
    attachments?: readonly Attachment[]
  },
): ChatPart[] {
  const parts: ChatPart[] = []
  const files = options.attachments ?? []
  // With a tree, each mention counts, and one that names nothing is text.
  // Without a tree, only the mention of a file of the message counts. Each
  // other `@` is plain text, so code or a link right after it keeps its part.
  const counts = (mention: Mention) =>
    options.mentions !== undefined ||
    attachmentForMention(mention, files) !== undefined
  let strong = false
  const addText = (value: string) => {
    const last = parts.at(-1)
    if (last?.kind === 'text' && last.strong === strong) last.text += value
    else parts.push({ kind: 'text', text: value, strong })
  }
  const addMention = (mention: Mention) => {
    const { source, path } = mention
    const attachment = attachmentForMention(mention, files)
    if (attachment) {
      parts.push({ kind: 'attachment', source, path, attachment, strong })
      return
    }
    const entry = options.mentions?.(mention)
    if (entry) parts.push({ kind: 'file', source, entry, strong })
    else addText(source)
  }
  const take = (list: readonly Token[]) => {
    for (const token of list) {
      if (token.kind === 'mark') strong = !strong
      else if (token.kind === 'text') addText(token.text)
      else if (token.kind === 'code') {
        strong = false
        parts.push(token)
      } else if (token.kind === 'mention') addMention(token.mention)
      else {
        const target = linkTarget(token.href, links)
        if (target) {
          parts.push({ kind: 'chip', source: token.source, target, strong })
        } else if (token.markdown) {
          take(
            tokens(token.source, {
              marks: options.strong,
              links: false,
              mentions: () => false,
            }),
          )
        } else addText(token.source)
      }
    }
  }
  take(
    tokens(text, {
      marks: options.strong,
      links: true,
      mentions: counts,
    }),
  )
  return parts
}

/**
 * The files of a message that no part shows as a chip, in their order. A
 * file whose mention stands only in code, or that the text does not
 * mention, such as a file of a message from before files had a place in
 * the text, shows under the message.
 */
export function filesWithoutChip(
  parts: readonly ChatPart[],
  attachments: readonly Attachment[],
): Attachment[] {
  const shown = new Set(
    parts.flatMap((part) =>
      part.kind === 'attachment' ? [part.attachment.id] : [],
    ),
  )
  return attachments.filter((file) => !shown.has(file.id))
}
