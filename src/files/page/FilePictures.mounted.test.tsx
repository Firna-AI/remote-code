// @vitest-environment happy-dom

import { act } from 'react'
import { expect, it } from 'vitest'
import type { FileEntry } from '../../shared/generated/FileEntry'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { envelopeAfter } from '../files-test-kit'
import { shownRows } from '../mount-test-kit'
import {
  controls,
  fakeDecoder,
  gif,
  jpeg,
  openFile,
  pictureOf,
  pixelPng,
  png,
  titles,
  webp,
} from './picture-test-kit'

it('shows each image file as a picture by its name, at the size that the browser draws, whatever type its read gives', async () => {
  const cases = [
    // The runner gives a PNG or a JPEG file the image type of its extension.
    {
      file: {
        path: 'screenshots/checkout-acme-7f3k.png',
        displayPath: 'screenshots/checkout-[redacted].png',
        mediaType: 'image/png',
        encoding: 'base64',
        content: png,
        sizeBytes: 86,
      },
      size: [3, 2],
      expected: {
        decoded: [`data:image/png;base64,${png}`],
        picture: {
          alt: 'checkout-[redacted].png',
          src: `data:image/png;base64,${png}`,
          width: '3px',
          ratio: '3 / 2',
        },
        text: 'screenshots/checkout-[redacted].png',
        controls: {
          downloads: ['Download checkout-[redacted].png'],
          copy: 'off',
        },
      },
    },
    // The runner gives a GIF or a WebP file the type of text by its name,
    // then the type of other bytes, as its bytes are not text.
    {
      file: {
        path: 'docs/Loading.GIF',
        mediaType: 'application/octet-stream',
        encoding: 'base64',
        content: gif,
        sizeBytes: 43,
      },
      size: [1, 1],
      expected: {
        decoded: [`data:image/gif;base64,${gif}`],
        picture: {
          alt: 'Loading.GIF',
          src: `data:image/gif;base64,${gif}`,
          width: '1px',
          ratio: '1 / 1',
        },
        text: 'docs/Loading.GIF',
        controls: { downloads: ['Download Loading.GIF'], copy: 'off' },
      },
    },
    // The Boat file read gives each binary file the type of other bytes.
    {
      file: {
        path: 'public/hero.webp',
        mediaType: 'application/octet-stream',
        encoding: 'base64',
        content: webp,
        sizeBytes: 34,
      },
      size: [1, 1],
      expected: {
        decoded: [`data:image/webp;base64,${webp}`],
        picture: {
          alt: 'hero.webp',
          src: `data:image/webp;base64,${webp}`,
          width: '1px',
          ratio: '1 / 1',
        },
        text: 'public/hero.webp',
        controls: { downloads: ['Download hero.webp'], copy: 'off' },
      },
    },
    {
      file: {
        path: 'photos/team.jpg',
        mediaType: 'application/octet-stream',
        encoding: 'base64',
        content: jpeg,
        sizeBytes: 134,
      },
      size: [1, 1],
      expected: {
        decoded: [`data:image/jpeg;base64,${jpeg}`],
        picture: {
          alt: 'team.jpg',
          src: `data:image/jpeg;base64,${jpeg}`,
          width: '1px',
          ratio: '1 / 1',
        },
        text: 'photos/team.jpg',
        controls: { downloads: ['Download team.jpg'], copy: 'off' },
      },
    },
  ] as const
  for (const { file, size, expected } of cases) {
    const [width, height] = size
    const made = fakeDecoder()
    const { view } = await openFile(file)
    // The page shows no picture box before the browser knows its size.
    const waiting = view.container.textContent
    made.at(0)?.draw(width, height)

    expect(
      {
        waiting,
        decoded: made.map((picture) => picture.src),
        picture: pictureOf(view.container),
        text: view.container.textContent,
        controls: controls(view.container),
        leaks: view.container.innerHTML.includes('acme-7f3k'),
      },
      file.path,
    ).toEqual({
      ...expected,
      waiting: `${expected.text}Opening the file`,
      leaks: false,
    })
    view.unmount()
  }
})

it('keeps the last picture on screen until the browser draws the changed file', async () => {
  const made = fakeDecoder()
  const server = new FakeApiServer()
  const path = 'screenshots/home.png'
  const entry: FileEntry = {
    path,
    name: 'home.png',
    kind: 'file',
    change: null,
  }
  server.json('GET', filePaths.tree(FAKE_IDS.org, FAKE_IDS.workspace), {
    revision: 1,
    entries: [entry],
  })
  const read = {
    path,
    mediaType: 'image/png',
    encoding: 'base64',
    content: png,
    sizeBytes: 86,
  } as const
  const { view, held } = await openFile(read, server)
  made.at(0)?.draw(3, 2)
  server.json(
    'GET',
    filePaths.content(FAKE_IDS.org, FAKE_IDS.workspace, path),
    { ...read, content: pixelPng, sizeBytes: 70 },
  )
  act(() =>
    server.events.emit(
      envelopeAfter(server, {
        type: 'files.changed',
        delta: { revision: 2, changes: [{ operation: 'upsert', entry }] },
      }),
    ),
  )
  await act(async () => {
    await held.release()
  })
  const waiting = pictureOf(view.container)
  made.at(1)?.draw(1, 1)

  expect({
    decoded: made.map((picture) => picture.src),
    waiting,
    drawn: pictureOf(view.container),
  }).toEqual({
    decoded: [
      `data:image/png;base64,${png}`,
      `data:image/png;base64,${pixelPng}`,
    ],
    waiting: {
      alt: 'home.png',
      src: `data:image/png;base64,${png}`,
      width: '3px',
      ratio: '3 / 2',
    },
    drawn: {
      alt: 'home.png',
      src: `data:image/png;base64,${pixelPng}`,
      width: '1px',
      ratio: '1 / 1',
    },
  })
})

it('offers the download of an image file whose bytes the browser cannot draw, with Copy off also for bytes that are text', async () => {
  const made = fakeDecoder()
  // The runner gives text bytes under a GIF name the type of text.
  const { view } = await openFile({
    path: 'assets/logo.gif',
    mediaType: 'text/plain',
    encoding: 'utf-8',
    content: 'Café menu\n',
    sizeBytes: 11,
  })
  made.at(0)?.refuse()

  expect({
    // The address holds the UTF-8 bytes of the text.
    decoded: made.map((picture) => picture.src),
    titles: titles(view.container),
    rows: shownRows(view.container),
    picture: pictureOf(view.container),
    controls: controls(view.container),
  }).toEqual({
    decoded: ['data:image/gif;base64,Q2Fmw6kgbWVudQo='],
    titles: ['Download this file to open it'],
    rows: [],
    picture: null,
    controls: { downloads: ['Download logo.gif', 'Download'], copy: 'off' },
  })
})

it('shows an image file with no bytes as an empty file', async () => {
  const made = fakeDecoder()
  // The runner sends the empty text of a file with no bytes.
  const { view } = await openFile({
    path: 'screenshots/pending.png',
    mediaType: 'image/png',
    encoding: 'utf-8',
    content: '',
    sizeBytes: 0,
  })

  expect({
    decoded: made.map((picture) => picture.src),
    titles: titles(view.container),
  }).toEqual({ decoded: [], titles: ['This file is empty'] })
})

it('shows an SVG file as its source with line numbers, with Copy on', async () => {
  const made = fakeDecoder()
  const svg =
    '<svg viewBox="0 0 2 1">\n  <rect width="2" height="1" />\n</svg>\n'
  const { view } = await openFile({
    path: 'public/logo.svg',
    mediaType: 'image/svg+xml',
    encoding: 'utf-8',
    content: svg,
    sizeBytes: svg.length,
  })

  expect({
    decoded: made.map((picture) => picture.src),
    rows: shownRows(view.container),
    lines: /\d+ lines/.exec(view.container.textContent ?? '')?.[0],
    controls: controls(view.container),
  }).toEqual({
    decoded: [],
    rows: [
      ['1', '<svg viewBox="0 0 2 1">'],
      ['2', '  <rect width="2" height="1" />'],
      ['3', '</svg>'],
    ],
    lines: '3 lines',
    controls: { downloads: ['Download logo.svg'], copy: 'on' },
  })
})
