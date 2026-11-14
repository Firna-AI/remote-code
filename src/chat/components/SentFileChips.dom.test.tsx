// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { FileEntry } from '../../shared/generated/FileEntry'
import type { Attachment } from '../../shared/generated/Attachment'
import type { UserMessage } from '../../shared/generated/UserMessage'
import { attachmentPath } from '../../shared/attachment-paths'
import { queryAllByRole } from '../../test-support/dom-queries'
import { FAKE_IDS, FAKE_TIME, fakeUser } from '../../test-support/fixtures/core'
import { senderSnapshot } from '../../test-support/fixtures/workspaces'
import { mount, press } from '../../test-support/mount'
import { LinksProvider } from '../links/LinksContext'
import { Copying, copyAll } from '../links/mention-copy-test-kit'
import {
  MentionsProvider,
  type ChatMentions,
} from '../mentions/MentionsContext'
import { textOf } from './render-kit'
import { UserBubble } from './TranscriptItem'

const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}

const readme: FileEntry = {
  path: 'README.md',
  name: 'README.md',
  kind: 'file',
  change: null,
}

/**
 * A file of a sent message, with the copy path that its upload reply
 * gives, or with no path, as a file of a message from before paths.
 */
async function attached(
  id: string,
  name: string,
  sizeBytes: number,
  copied = true,
): Promise<Attachment> {
  const image = name.endsWith('.png')
  return {
    id,
    name,
    path: copied ? await attachmentPath({ id, name }) : null,
    kind: image ? 'image' : 'file',
    mediaType: image ? 'image/png' : 'text/plain',
    sizeBytes,
  }
}

/** A screenshot, notes, and an old log without a path. */
async function files() {
  return {
    shot: await attached('file-shot', 'Login screen.png', 290_816),
    notes: await attached('file-notes', 'notes.md', 2048),
    old: await attached('file-old', 'old.log', 1024, false),
  }
}

function message(
  id: string,
  text: string,
  attachments: readonly Attachment[],
  state: UserMessage['state'] = 'sent',
): UserMessage {
  return {
    id,
    sessionId: FAKE_IDS.session,
    sender: senderSnapshot(fakeUser),
    text,
    attachments,
    choice: opus,
    createdAt: FAKE_TIME,
    state,
  }
}

/**
 * Mounts sent messages. With `workspaceFiles`, the chat has the files of
 * its workspace, as a chat that is not archived: a tree that holds
 * `README.md`, and the open of a file, which `opened` records.
 */
async function mountMessages(
  messages: readonly UserMessage[],
  workspaceFiles: boolean,
) {
  const opened: string[] = []
  const snapshot = {
    tree: { entries: new Map([[readme.path, readme]]) },
    treeError: null,
    treeUnavailable: false,
  }
  const value: ChatMentions = {
    files: { subscribe: () => () => undefined, getSnapshot: () => snapshot },
    openFile: (path) => opened.push(path),
    showFolder: () => undefined,
    href: (entry) => `/files/${entry.path}`,
  }
  const { container } = await mount(
    <LinksProvider value={{ links: { orgId: FAKE_IDS.org, workspaces: [] } }}>
      <MentionsProvider value={workspaceFiles ? value : null}>
        <Copying>
          {messages.map((item) => (
            <UserBubble key={item.id} message={item} />
          ))}
        </Copying>
      </MentionsProvider>
    </LinksProvider>,
  )
  return { container, opened }
}

/** The bubble of the text of each mounted message, in their order. */
function bubbles(container: Element): Element[] {
  return Array.from(container.children, (user) => {
    const bubble = user.firstElementChild
    if (!bubble) throw new Error('A message has no bubble')
    return bubble
  })
}

/** The text of a bubble in its order: text, code, and the title of each chip. */
function placesOf(bubble: Element) {
  return Array.from(bubble.childNodes, (node) => {
    if (!(node instanceof Element)) return node.textContent
    if (node.hasAttribute('data-mention')) {
      return { chip: node.getAttribute('title') }
    }
    return { [node.tagName.toLowerCase()]: node.textContent }
  })
}

/** Each chip in `root`: its element, its mention, its title, and its words. */
function chipsOf(root: Element) {
  return Array.from(root.querySelectorAll('[data-mention]'), (chip) => ({
    tag: chip.tagName.toLowerCase(),
    mention: chip.getAttribute('data-mention'),
    title: chip.getAttribute('title'),
    words: textOf(chip.outerHTML).trim(),
  }))
}

describe('the chips of attached files in a sent message', () => {
  test('each mention of a file of the message shows as the chip of the file at its place, and only the files without a chip show under the message', async () => {
    const { shot, notes, old } = await files()
    const text = `Compare @${shot.path} with \`@${notes.path}\` and @README.md`
    const view = await mountMessages(
      [message('message-1', text, [shot, notes, old])],
      true,
    )
    const [bubble] = bubbles(view.container)
    const lists = queryAllByRole('list', 'Attached files', view.container)
    expect({
      places: placesOf(bubble),
      chips: chipsOf(bubble),
      listed: lists.flatMap((list) =>
        Array.from(list.children, (item) => textOf(item.outerHTML).trim()),
      ),
    }).toEqual({
      places: [
        'Compare ',
        { chip: 'Login screen.png' },
        ' with ',
        { code: `@${notes.path}` },
        ' and ',
        { chip: 'README.md' },
      ],
      chips: [
        {
          tag: 'a',
          mention: `@${shot.path}`,
          title: 'Login screen.png',
          words: 'Attached file Login screen.png 284 KB',
        },
        {
          tag: 'a',
          mention: '@README.md',
          title: 'README.md',
          words: 'File README.md',
        },
      ],
      listed: ['notes.md 2 KB', 'old.log 1 KB'],
    })
  })

  test('a press on the chip of a sent file opens the file tab of its copy, which its link names', async () => {
    const { shot } = await files()
    const view = await mountMessages(
      [message('message-1', `Look at @${shot.path}`, [shot])],
      true,
    )
    const links = Array.from(view.container.querySelectorAll('a'))
    for (const link of links) await press(link)
    expect({
      hrefs: links.map((link) => link.getAttribute('href')),
      opened: view.opened,
    }).toEqual({ hrefs: [`/files/${shot.path}`], opened: [shot.path] })
  })

  test('the chip of a sent file shows but opens nothing while its message waits, or in a chat without the files of its workspace', async () => {
    const { shot } = await files()
    const text = `Look at @${shot.path}`
    const pressed = async (view: Awaited<ReturnType<typeof mountMessages>>) => {
      const chips = chipsOf(view.container)
      for (const chip of view.container.querySelectorAll('[data-mention]')) {
        await press(chip)
      }
      return { chips, opened: view.opened }
    }
    const waits = await mountMessages(
      [message('message-1', text, [shot], 'queued')],
      true,
    )
    const archived = await mountMessages(
      [message('message-1', text, [shot])],
      false,
    )
    const chip = {
      tag: 'span',
      mention: `@${shot.path}`,
      title: 'Login screen.png',
      words: 'Attached file Login screen.png 284 KB',
    }
    expect({
      waits: await pressed(waits),
      archived: await pressed(archived),
    }).toEqual({
      waits: { chips: [chip], opened: [] },
      archived: { chips: [chip], opened: [] },
    })
  })

  test('a copy of sent messages gives the mention of the chip of each file, also of a chip that opens nothing', async () => {
    const { shot, notes } = await files()
    const view = await mountMessages(
      [
        message('message-1', `Compare @${shot.path} and @${notes.path}`, [
          shot,
          notes,
        ]),
        message('message-2', `Then @${shot.path}`, [shot], 'queued'),
      ],
      true,
    )
    expect(copyAll(view.container)).toEqual({
      kept: true,
      text: `Compare @${shot.path} and @${notes.path}\nThen @${shot.path}`,
    })
  })
})
