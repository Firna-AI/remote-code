// @vitest-environment happy-dom

import { act } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { DiffResponse } from '../../shared/generated/DiffResponse'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { accessibleName } from '../../test-support/dom-queries'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { testNavigation } from '../files-test-kit'
import { heldFetch, mountRoot, press, startedFiles } from '../mount-test-kit'
import { DiffPage } from './DiffPage'
import { FilePage } from './FilePage'

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

/** The PNG signature: eight bytes that are not UTF-8 text. */
const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const tooLarge = {
  error: {
    code: 'file_too_large',
    message: 'The file is too large to open.',
    sizeBytes: 3_407_872,
    limitBytes: 1_048_576,
  },
}

/** The names of the controls on screen that start a download. */
function downloadControls(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button, a')]
    .map((element) => accessibleName(element))
    .filter((name) => name.startsWith('Download'))
}

function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('h2')].map((h2) => h2.textContent ?? '')
}

function statuses(container: HTMLElement): string[] {
  const shown = container.querySelectorAll('[role="status"]')
  return [...shown].map((status) => status.textContent ?? '')
}

/**
 * The files that the browser download saves: the file of each address,
 * each link that the page clicks, and each address that it frees.
 */
function recordSaves() {
  const files: Blob[] = []
  const clicked: { name: string; address: string }[] = []
  const freed: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
    if (!(file instanceof Blob)) throw new Error('Only a file gets an address.')
    files.push(file)
    return `blob:saved/${files.length}`
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((address) => {
    freed.push(address)
  })
  const onClick = (event: Event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return
    event.preventDefault()
    clicked.push({ name: event.target.download, address: event.target.href })
  }
  document.addEventListener('click', onClick)
  onTestFinished(() => {
    document.removeEventListener('click', onClick)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  return { files, clicked, freed }
}

it("shows that the download didn't start when the route refuses the file, and saves the bytes that the route sends", async () => {
  const server = new FakeApiServer()
  const path = 'public/hero.png'
  server.json('GET', filePaths.content(org, id, path), {
    path,
    mediaType: 'image/png',
    encoding: 'base64',
    content: btoa(String.fromCharCode(...png)),
    sizeBytes: png.length,
  })
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const view = mountRoot()
  // The page uses the browser targets, which read with the page's fetch.
  const downloads = heldFetch(server)
  vi.stubGlobal('fetch', downloads.fetch)
  const saves = recordSaves()
  view.render(
    <FilePage
      files={files}
      layout="desktop"
      navigation={testNavigation()}
      tab={{ kind: 'file', path, mode: 'preview' }}
    />,
  )
  await act(async () => {
    await held.release()
  })
  expect(downloadControls(view.container)).toEqual([
    'Download hero.png',
    'Download',
  ])

  const route = filePaths.download(org, id, path)
  const refusals = [
    [413, tooLarge],
    [404, { error: { code: 'file_not_found', message: 'Gone.' } }],
    [503, { error: { code: 'file_unavailable', message: 'Asleep.' } }],
  ] as const
  for (const [status, body] of refusals) {
    server.json('GET', route, body, status)
    press(view.container, 'button', 'Download hero.png')
    await act(async () => {
      await downloads.release()
    })
    expect(statuses(view.container), String(status)).toEqual([
      "The download didn't start. Try again.",
    ])
  }
  expect(saves.files).toEqual([])
  expect(saves.clicked).toEqual([])

  server.response('GET', route, new Response(Uint8Array.from(png)))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  press(view.container, 'button', 'Download hero.png')
  await act(async () => {
    await downloads.release()
  })
  expect(statuses(view.container)).toEqual([''])
  expect(saves.clicked).toEqual([{ name: 'hero.png', address: 'blob:saved/1' }])
  expect(saves.files).toHaveLength(1)
  expect([...new Uint8Array(await saves.files[0].arrayBuffer())]).toEqual(png)
  expect(document.body.querySelector('a')).toBeNull()
  // The address stays until the browser starts the download, then goes.
  expect(saves.freed).toEqual([])
  vi.runOnlyPendingTimers()
  expect(saves.freed).toEqual(['blob:saved/1'])
})

it('offers no Download on a file page or a diff page over the read limit, also for a picture', async () => {
  const server = new FakeApiServer()
  const path = 'public/catalog.json'
  const picture = 'screenshots/whole-screen.png'
  server.json('GET', filePaths.content(org, id, path), tooLarge, 413)
  server.json('GET', filePaths.content(org, id, picture), tooLarge, 413)
  server.json('GET', filePaths.diff(org, id, path), tooLarge, 413)
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const navigation = testNavigation()
  const pages = [
    [
      path,
      <FilePage
        files={files}
        layout="desktop"
        navigation={navigation}
        tab={{ kind: 'file', path, mode: 'preview' }}
      />,
      'Open this file in the terminal',
    ],
    [
      picture,
      <FilePage
        files={files}
        layout="desktop"
        navigation={navigation}
        tab={{ kind: 'file', path: picture, mode: 'preview' }}
      />,
      'Open this file in the terminal',
    ],
    [
      `diff of ${path}`,
      <DiffPage
        files={files}
        layout="desktop"
        navigation={navigation}
        tab={{ kind: 'diff', path }}
      />,
      'See this diff in the terminal',
    ],
  ] as const
  for (const [shown, page, title] of pages) {
    const view = mountRoot()
    view.render(page)
    await act(async () => {
      await held.release()
    })
    expect(titles(view.container), shown).toEqual([title])
    expect(downloadControls(view.container), shown).toEqual([])
    view.unmount()
  }
})

it('links a binary diff to its file tab in place of Download', async () => {
  const server = new FakeApiServer()
  const path = 'public/hero.png'
  const diff: DiffResponse = {
    path,
    baseBranch: 'main',
    oldContent: null,
    newContent: null,
    binary: true,
    patch: '',
  }
  server.json('GET', filePaths.diff(org, id, path), diff)
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const navigation = testNavigation()
  const view = mountRoot()
  view.render(
    <DiffPage
      files={files}
      layout="desktop"
      navigation={navigation}
      tab={{ kind: 'diff', path }}
    />,
  )
  await act(async () => {
    await held.release()
  })
  expect(titles(view.container)).toEqual(['This binary file changed'])
  expect(downloadControls(view.container)).toEqual([])

  press(view.container, 'link', 'Open the file')

  expect(navigation.visited).toEqual([
    { kind: 'file', path: 'public/hero.png', mode: 'preview' },
  ])
})
