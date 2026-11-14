// @vitest-environment happy-dom

import { act, useState } from 'react'
import { expect, it } from 'vitest'
import type { FileResponse } from '../../shared/generated/FileResponse'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { testNavigation } from '../files-test-kit'
import type { WorkspaceFiles } from '../model/files-store'
import {
  fakeWorkers,
  heldFetch,
  mountRoot,
  press,
  shownRows,
  startedFiles,
} from '../mount-test-kit'
import type { FileTab, FilesNavigation } from '../navigation'
import { FilePage } from './FilePage'

/** Stands in for the shell: it passes on each target and shows each file tab. */
function Shell(props: {
  files: WorkspaceFiles
  first: FileTab
  navigation: FilesNavigation
}) {
  const [tab, setTab] = useState(props.first)
  const navigation: FilesNavigation = {
    href: props.navigation.href,
    navigate: (target) => {
      props.navigation.navigate(target)
      if (target.kind === 'file') setTab(target)
    },
    keep: props.navigation.keep,
  }
  return (
    <FilePage
      files={props.files}
      layout="desktop"
      navigation={navigation}
      tab={tab}
    />
  )
}

function headings(container: HTMLElement): string[] {
  return [...container.querySelectorAll('h1')].map((h1) => h1.textContent ?? '')
}

it('shows the source of a nested Markdown file in the same tab after a press on Source', async () => {
  const server = new FakeApiServer()
  const path = 'docs/guide.md'
  const text = '# Guide\n\nRun the checks.\n'
  const file: FileResponse = {
    path,
    mediaType: 'text/markdown',
    encoding: 'utf-8',
    content: text,
    sizeBytes: new TextEncoder().encode(text).byteLength,
  }
  server.json(
    'GET',
    filePaths.content(FAKE_IDS.org, FAKE_IDS.workspace, path),
    file,
  )
  const workers = fakeWorkers()
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const navigation = testNavigation()
  const view = mountRoot()
  view.render(
    <Shell
      files={files}
      first={{ kind: 'file', path, mode: 'preview' }}
      navigation={navigation}
    />,
  )
  await act(async () => {
    await held.release()
  })
  workers.made[0].answer()
  expect(headings(view.container)).toEqual(['Guide'])
  expect(shownRows(view.container)).toEqual([])

  press(view.container, 'radio', 'Source')

  expect(navigation.visited).toEqual([
    { kind: 'file', path: 'docs/guide.md', mode: 'source' },
  ])
  expect(headings(view.container)).toEqual([])
  expect(shownRows(view.container)).toEqual([
    ['1', '# Guide'],
    ['2', ''],
    ['3', 'Run the checks.'],
  ])
})
