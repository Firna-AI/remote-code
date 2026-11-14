// @vitest-environment happy-dom

import { act } from 'react'
import { expect, it } from 'vitest'
import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import type { DiffResponse } from '../../shared/generated/DiffResponse'
import type { FileResponse } from '../../shared/generated/FileResponse'
import { requestLines } from '../../app/test-kit'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { testNavigation } from '../files-test-kit'
import { tabLabel } from '../model/file-labels'
import { heldFetch, mountRoot, startedFiles } from '../mount-test-kit'
import { DiffPage } from './DiffPage'
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

/** The name of a page and the label of its path in the header. */
function named(container: HTMLElement) {
  return {
    name: container.querySelector('section')?.getAttribute('aria-label'),
    label: container.querySelector('span[title]')?.getAttribute('title'),
  }
}

it('reads each page by its real path, and names it from the lists, then from its reply, or File without a record, and gives each tab the label of its read', async () => {
  const server = new FakeApiServer()
  const path = 'scripts/seed-acme-7f3k.sql'
  const label = 'scripts/seed-[redacted].sql'
  const other = 'notes/acme-7f3k.md'
  server.json('GET', filePaths.tree(org, id), {
    revision: 1,
    entries: [
      { path: 'scripts', name: 'scripts', kind: 'directory', change: null },
      {
        path,
        displayPath: label,
        name: 'seed-[redacted].sql',
        kind: 'file',
        change: 'added',
      },
    ],
  })
  const changes: ChangesResponse = {
    baseBranch: 'main',
    files: [
      {
        path,
        displayPath: label,
        change: 'added',
        added: 1,
        removed: 0,
        uncommitted: true,
      },
    ],
    summary: { files: 1, added: 1, removed: 0 },
  }
  server.json('GET', filePaths.changes(org, id), changes)
  server.json('GET', filePaths.content(org, id, path), {
    ...textFile(path, 'BEGIN;\n'),
    displayPath: label,
  })
  server.json('GET', filePaths.content(org, id, other), {
    ...textFile(other, '# Notes\n'),
    displayPath: 'notes/[redacted].md',
  })
  const diff: DiffResponse = {
    path,
    displayPath: label,
    baseBranch: 'main',
    oldContent: null,
    newContent: 'BEGIN;\n',
    patch: '@@ -0,0 +1 @@\n+BEGIN;\n',
    binary: false,
  }
  server.json('GET', filePaths.diff(org, id, path), diff)
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const common = {
    files,
    layout: 'desktop' as const,
    navigation: testNavigation(),
  }
  const views = [
    <FilePage {...common} tab={{ kind: 'file', path, mode: 'source' }} />,
    <FilePage
      {...common}
      tab={{ kind: 'file', path: other, mode: 'source' }}
    />,
    <DiffPage {...common} tab={{ kind: 'diff', path }} />,
  ].map((page) => {
    const view = mountRoot()
    view.render(page)
    return view
  })
  const tabs = () =>
    [path, other].map((at) => tabLabel(files.getSnapshot(), at, 'file'))
  const before = views.map((view) => named(view.container))
  const tabsBefore = tabs()
  await act(async () => {
    await held.release()
  })
  expect({
    before,
    after: views.map((view) => named(view.container)),
    tabsBefore,
    tabsAfter: tabs(),
    reads: requestLines(server).filter((line) => /content|diff/.test(line)),
    leaks: views.some((view) =>
      view.container.innerHTML
        .replace(/ href="[^"]*"/g, '')
        .includes('acme-7f3k'),
    ),
  }).toEqual({
    before: [
      { name: 'seed-[redacted].sql', label },
      { name: 'File', label: undefined },
      { name: 'seed-[redacted].sql', label },
    ],
    after: [
      { name: 'seed-[redacted].sql', label },
      { name: '[redacted].md', label: 'notes/[redacted].md' },
      { name: 'seed-[redacted].sql', label },
    ],
    tabsBefore: [label, null],
    tabsAfter: [label, 'notes/[redacted].md'],
    reads: [
      `GET ${filePaths.content(org, id, path)}`,
      `GET ${filePaths.content(org, id, other)}`,
      `GET ${filePaths.diff(org, id, path)}`,
    ],
    leaks: false,
  })
})
