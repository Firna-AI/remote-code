import { describe, expect, test } from 'vitest'
import type { FileEntry } from '../../shared/generated/FileEntry'
import type { Attachment } from '../../shared/generated/Attachment'
import { attachmentPath } from '../../shared/attachment-paths'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { chatParts, type ChatPart, type MentionLookup } from './chat-parts'

const links = { orgId: FAKE_IDS.org, workspaces: [] }

const entries: FileEntry[] = [
  { path: 'src/app.ts', name: 'app.ts', kind: 'file', change: null },
  { path: 'src/lib', name: 'lib', kind: 'directory', change: null },
]

/** Finds a file by a file mention, and a folder by a folder mention. */
const lookup: MentionLookup = (mention) =>
  entries.find(
    (entry) =>
      entry.path === mention.path &&
      (entry.kind === 'directory') === mention.folder,
  )

function shapes(parts: readonly ChatPart[]) {
  return parts.map((part) =>
    part.kind === 'file'
      ? { file: part.entry.path }
      : part.kind === 'attachment'
        ? { attachment: part.attachment.id, path: part.path }
        : part.kind === 'chip'
          ? { chip: part.source }
          : { [part.kind]: part.text },
  )
}

describe('mentions in a sent message', () => {
  test('a mention of an entry of the tree is a file chip, and every other mention stays text', () => {
    const text =
      'Move @src/app.ts into @src/lib/ and @src/lib but not @src/gone.ts'
    expect(
      shapes(chatParts(text, links, { strong: false, mentions: lookup })),
    ).toEqual([
      { text: 'Move ' },
      { file: 'src/app.ts' },
      { text: ' into ' },
      { file: 'src/lib' },
      { text: ' and @src/lib but not @src/gone.ts' },
    ])
  })

  test('a mention in code stays code, and an answer without mentions keeps its text', () => {
    const text = 'Read `@src/app.ts` and @src/app.ts'
    expect({
      message: shapes(
        chatParts(text, links, { strong: false, mentions: lookup }),
      ),
      answer: shapes(chatParts(text, links, { strong: true })),
    }).toEqual({
      message: [
        { text: 'Read ' },
        { code: '@src/app.ts' },
        { text: ' and ' },
        { file: 'src/app.ts' },
      ],
      answer: [
        { text: 'Read ' },
        { code: '@src/app.ts' },
        { text: ' and @src/app.ts' },
      ],
    })
  })

  test('a mention of a file of the message is its chip, before an entry of the tree and also without a tree, and a mention in code stays code', async () => {
    const path = await attachmentPath({ id: 'shot', name: 'login.png' })
    const shot: Attachment = {
      id: 'shot',
      name: 'login.png',
      path,
      kind: 'image',
      mediaType: 'image/png',
      sizeBytes: 2048,
    }
    const legacy: Attachment = { ...shot, id: 'legacy', path: null }
    // The tree names the copy too. The chip of the file comes first.
    const copy: FileEntry = {
      path,
      name: 'login.png',
      kind: 'file',
      change: null,
    }
    const withCopy: MentionLookup = (mention) =>
      mention.path === path && !mention.folder ? copy : lookup(mention)
    const text = `Compare @${path} with @src/app.ts and not \`@${path}\` or @${path}/`
    const read = (mentions?: MentionLookup) =>
      shapes(
        chatParts(text, links, {
          strong: false,
          mentions,
          attachments: [legacy, shot],
        }),
      )
    expect({ tree: read(withCopy), archived: read() }).toEqual({
      tree: [
        { text: 'Compare ' },
        { attachment: 'shot', path },
        { text: ' with ' },
        { file: 'src/app.ts' },
        { text: ' and not ' },
        { code: `@${path}` },
        { text: ` or @${path}/` },
      ],
      archived: [
        { text: 'Compare ' },
        { attachment: 'shot', path },
        { text: ' with @src/app.ts and not ' },
        { code: `@${path}` },
        { text: ` or @${path}/` },
      ],
    })
  })
})
