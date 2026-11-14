// @vitest-environment happy-dom

import { act, useLayoutEffect, type ReactNode } from 'react'
import { expect, it } from 'vitest'
import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import type { DiffResponse } from '../../shared/generated/DiffResponse'
import type { FileResponse } from '../../shared/generated/FileResponse'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { testNavigation } from '../files-test-kit'
import {
  heldFetch,
  mountRoot,
  press,
  shownRows,
  startedFiles,
} from '../mount-test-kit'
import { DiffPage } from './DiffPage'
import type { FileActionTargets } from './file-actions'
import { FilePage } from './FilePage'

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

function textFile(path: string, content: string): FileResponse {
  return {
    path,
    mediaType: 'text/plain',
    encoding: 'utf-8',
    content,
    sizeBytes: new TextEncoder().encode(content).byteLength,
  }
}

/** Calls `onCommit` after each commit of its own render, before effects run. */
function Recorded(props: { children: ReactNode; onCommit: () => void }) {
  useLayoutEffect(() => {
    props.onCommit()
  })
  return props.children
}

it('shows the lines of the open file that a started store reads', async () => {
  const server = new FakeApiServer()
  const path = 'src/cart.ts'
  server.json(
    'GET',
    filePaths.content(org, id, path),
    textFile(path, 'export const total = 2\nexport const items = []\n'),
  )
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const view = mountRoot()
  view.render(
    <FilePage
      files={files}
      layout="desktop"
      navigation={testNavigation()}
      tab={{ kind: 'file', path, mode: 'preview' }}
    />,
  )
  expect(view.container.textContent).toContain('Opening the file')
  expect(shownRows(view.container)).toEqual([])

  await act(async () => {
    await held.release()
  })

  expect(shownRows(view.container)).toEqual([
    ['1', 'export const total = 2'],
    ['2', 'export const items = []'],
  ])
  expect(view.container.textContent).toContain('2 lines')
  expect(view.container.textContent).not.toContain('Opening the file')
})

it('shows the diff of the open change that a started store reads, with the counts of its change list', async () => {
  const server = new FakeApiServer()
  const path = 'src/cart.ts'
  const changes: ChangesResponse = {
    baseBranch: 'main',
    files: [
      { path, change: 'modified', added: 2, removed: 1, uncommitted: false },
    ],
    summary: { files: 1, added: 2, removed: 1 },
  }
  const diff: DiffResponse = {
    path,
    baseBranch: 'main',
    oldContent: 'a\nb\n',
    newContent: 'a\nc\nd\n',
    binary: false,
    patch: '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n',
  }
  server.json('GET', filePaths.changes(org, id), changes)
  server.json('GET', filePaths.diff(org, id, path), diff)
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const view = mountRoot()
  view.render(
    <DiffPage
      files={files}
      layout="desktop"
      navigation={testNavigation()}
      tab={{ kind: 'diff', path }}
    />,
  )
  expect(view.container.textContent).toContain('Opening the diff')
  expect(shownRows(view.container)).toEqual([])

  await act(async () => {
    await held.release()
  })

  expect(shownRows(view.container)).toEqual([
    ['@@ -1,2 +1,3 @@'],
    ['1', '1', ' ', 'a'],
    ['2', '', '−', 'b'],
    ['', '2', '+', 'c'],
    ['', '3', '+', 'd'],
  ])
  const labels = [...view.container.querySelectorAll('[role="img"]')].map(
    (element) => element.getAttribute('aria-label'),
  )
  expect(labels).toContain('2 lines added, 1 removed')
  expect(view.container.textContent).not.toContain('Opening the diff')
})

it('shows no line of the old path after the tab moves to another file, also before the new file arrives', async () => {
  const server = new FakeApiServer()
  for (const [path, text] of [
    ['src/a.ts', 'export const a = 1\n'],
    ['src/b.ts', 'export const b = 2\n'],
  ]) {
    server.json('GET', filePaths.content(org, id, path), textFile(path, text))
  }
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const view = mountRoot()
  const commits: string[][][] = []
  const show = (path: string) =>
    view.render(
      <Recorded
        onCommit={() => {
          commits.push(shownRows(view.container))
        }}
      >
        <FilePage
          files={files}
          layout="desktop"
          navigation={testNavigation()}
          tab={{ kind: 'file', path, mode: 'preview' }}
        />
      </Recorded>,
    )
  show('src/a.ts')
  await act(async () => {
    await held.release()
  })
  expect(shownRows(view.container)).toEqual([['1', 'export const a = 1']])
  commits.length = 0

  show('src/b.ts')

  // The first commit of the new tab comes before its read starts. No list
  // names src/b.ts, and the reply of src/a.ts is not for it, so the page
  // shows "File" until its own reply names it.
  expect(commits).toEqual([[]])
  const page = view.container.querySelector('section')
  expect(page?.getAttribute('aria-label')).toBe('File')
  expect(view.container.textContent).toContain('Opening the file')
  expect(shownRows(view.container)).toEqual([])

  await act(async () => {
    await held.release()
  })

  expect(shownRows(view.container)).toEqual([['1', 'export const b = 2']])
})

it('copies the leading byte order mark of a base64 file, and leaves it out of the lines on screen', async () => {
  const server = new FakeApiServer()
  const path = 'src/notes.ts'
  // The bytes EF BB BF are the UTF-8 byte order mark, U+FEFF.
  const bytes = [0xef, 0xbb, 0xbf, ...new TextEncoder().encode('const a = 1\n')]
  const file: FileResponse = {
    path,
    mediaType: 'application/octet-stream',
    encoding: 'base64',
    content: btoa(String.fromCharCode(...bytes)),
    sizeBytes: bytes.length,
  }
  server.json('GET', filePaths.content(org, id, path), file)
  const copied: string[] = []
  const targets: FileActionTargets = {
    writeText: async (text) => {
      copied.push(text)
    },
    download: async () => true,
  }
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const view = mountRoot()
  view.render(
    <FilePage
      files={files}
      layout="desktop"
      navigation={testNavigation()}
      tab={{ kind: 'file', path, mode: 'preview' }}
      targets={targets}
    />,
  )
  await act(async () => {
    await held.release()
  })
  expect(shownRows(view.container)).toEqual([['1', 'const a = 1']])
  expect(view.container.textContent).toContain('1 line')

  press(view.container, 'button', 'Copy the text of notes.ts')
  // The header shows the result of Copy after the clipboard answers.
  await act(async () => {})

  expect(copied).toEqual(['\uFEFFconst a = 1\n'])
})
