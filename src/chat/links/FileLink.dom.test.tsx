// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import type { FileEntry } from '../../shared/generated/FileEntry'
import { accessibleName } from '../../test-support/dom-queries'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { mount, press } from '../../test-support/mount'
import {
  MentionsProvider,
  type ChatMentions,
} from '../mentions/MentionsContext'
import { LinkedText } from './LinkedText'
import { Copying, copyAll } from './mention-copy-test-kit'
import { LinksProvider } from './LinksContext'

const entries: FileEntry[] = [
  { path: 'src/lib', name: 'lib', kind: 'directory', change: null },
  { path: 'README.md', name: 'README.md', kind: 'file', change: null },
]

async function mountText(text: string | string[], mentions: boolean) {
  const opened: string[] = []
  const shown: string[] = []
  const snapshot = {
    tree: { entries: new Map(entries.map((item) => [item.path, item])) },
    treeError: null,
    treeUnavailable: false,
  }
  const value: ChatMentions = {
    files: { subscribe: () => () => undefined, getSnapshot: () => snapshot },
    openFile: (path) => opened.push(path),
    showFolder: (path) => shown.push(path),
    href: (item) => `/files/${item.path}`,
  }
  const texts = Array.isArray(text) ? text : [text]
  const { container } = await mount(
    <LinksProvider value={{ links: { orgId: FAKE_IDS.org, workspaces: [] } }}>
      <MentionsProvider value={value}>
        <Copying>
          {texts.map((item) => (
            <p key={item}>
              <LinkedText mentions={mentions} text={item} />
            </p>
          ))}
        </Copying>
      </MentionsProvider>
    </LinksProvider>,
  )
  return { container, opened, shown }
}

describe('file chips in a sent message', () => {
  test('each chip is a link to its page, and a plain click opens the file or shows the folder', async () => {
    const view = await mountText('Move @README.md into @src/lib/ now', true)
    const links = [...view.container.querySelectorAll('a')]
    for (const link of links) await press(link)
    expect({
      names: links.map((link) => accessibleName(link)),
      hrefs: links.map((link) => link.getAttribute('href')),
      titles: links.map((link) => link.getAttribute('title')),
      opened: view.opened,
      shown: view.shown,
    }).toEqual({
      names: ['File README.md', 'Folder lib'],
      hrefs: ['/files/README.md', '/files/src/lib'],
      titles: ['README.md', 'src/lib/'],
      opened: ['README.md'],
      shown: ['src/lib'],
    })
  })

  test('a copy across two messages gives the mention of each file chip, and a copy without one stays native', async () => {
    const view = await mountText(
      ['Move @README.md into @src/lib/ now', 'Then read @README.md'],
      true,
    )
    const withChips = copyAll(view.container)
    const answer = await mountText('Moved @README.md', false)
    expect({ withChips, plain: copyAll(answer.container) }).toEqual({
      withChips: {
        kept: true,
        text: 'Move @README.md into @src/lib/ now\nThen read @README.md',
      },
      plain: { kept: false, text: '' },
    })
  })

  test('a copy leaves out the text that the browser leaves out: the steps of a closed fold and text that takes no selection', async () => {
    const view = await mountText('Move @README.md now', true)
    const extra = document.createElement('div')
    extra.innerHTML =
      '<details><summary>1 tool call</summary><p>Hidden work</p></details>' +
      '<p><span style="user-select: none">No selection</span>Visible</p>'
    view.container.append(extra)
    expect(copyAll(view.container)).toEqual({
      kept: true,
      text: 'Move @README.md now\n1 tool call\nVisible',
    })
  })

  test('an answer shows each mention as text', async () => {
    const view = await mountText('Moved @README.md', false)
    expect({
      links: view.container.querySelectorAll('a').length,
      text: view.container.textContent,
    }).toEqual({ links: 0, text: 'Moved @README.md' })
  })
})
