import { expect, it } from 'vitest'
import type { Attachment } from './generated/Attachment'
import { mentionParts } from './mention-text'
import {
  attachmentForMention,
  hasOwnWords,
  textWithAttachmentNames,
} from './attachment-mentions'

const attachment = {
  id: 'image',
  name: 'Login screen.png',
  path: '.context/attachments/image/Login-screen.png',
  kind: 'image',
  mediaType: 'image/png',
  sizeBytes: 25,
} satisfies Attachment & { path: string }
const files = [attachment, { ...attachment, id: 'legacy', path: null }]

it('finds only a file mention of a file attached to this message', () => {
  const parts = mentionParts(
    `@${attachment.path} @${attachment.path}/ @src/login.ts`,
  )
  expect(
    parts
      .filter((part) => part.kind === 'mention')
      .map((part) => attachmentForMention(part, files)?.id),
  ).toEqual(['image', undefined, undefined])
})

it('uses original attached-file names and keeps other mentions unchanged', () => {
  expect(
    textWithAttachmentNames(
      `Compare @${attachment.path} with @src/login.ts and @${attachment.path}`,
      files,
    ),
  ).toBe('Compare Login screen.png with @src/login.ts and Login screen.png')
})

it('needs words outside the mentions of its own attached files', () => {
  expect(hasOwnWords(` @${attachment.path}\n@${attachment.path} `, files)).toBe(
    false,
  )
  expect(hasOwnWords(`Compare @${attachment.path}`, files)).toBe(true)
  expect(hasOwnWords('@src/login.ts', files)).toBe(true)
  expect(hasOwnWords('', files)).toBe(false)
})
