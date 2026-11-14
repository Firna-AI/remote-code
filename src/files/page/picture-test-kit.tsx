import { act } from 'react'
import { vi } from 'vitest'
import type { FileResponse } from '../../shared/generated/FileResponse'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { accessibleName } from '../../test-support/dom-queries'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { testNavigation } from '../files-test-kit'
import { heldFetch, mountRoot, startedFiles } from '../mount-test-kit'
import { FilePage } from './FilePage'

/**
 * Test kit of the pictures of the file page, for test files that run in
 * happy-dom. Tests only.
 */

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

/**
 * Small pictures that a browser draws, as base64: a PNG file of 3 × 2
 * pixels, and a file of 1 × 1 pixel in each format.
 */
export const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHUlEQVR4nGPQiFqQErVgQdQCBo2oEylRJxZEnQAAT8QIrR65Xy4AAAAASUVORK5CYII='
export const pixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
export const gif =
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
export const webp = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
export const jpeg =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

/**
 * Pictures that the test draws or refuses by hand, in place of the image
 * decoder of a browser. happy-dom reads a size from the bytes, but it
 * never refuses a picture. Each one keeps the address that the page gives
 * it.
 */
export function fakeDecoder() {
  const made: FakePicture[] = []
  class FakePicture {
    src = ''
    naturalWidth = 0
    naturalHeight = 0
    onload: (() => void) | null = null
    onerror: (() => void) | null = null

    constructor() {
      made.push(this)
    }

    /** The browser draws the bytes at their own size. */
    draw(width: number, height: number): void {
      this.naturalWidth = width
      this.naturalHeight = height
      act(() => this.onload?.())
    }

    /** The browser cannot draw the bytes. */
    refuse(): void {
      act(() => this.onerror?.())
    }
  }
  vi.stubGlobal('Image', FakePicture)
  return made
}

/**
 * Opens the file tab of the path of `file`, after its read gives `file`.
 * `server` can hold more routes, such as the tree. The held fetch delivers
 * each later read.
 */
export async function openFile(
  file: FileResponse,
  server = new FakeApiServer(),
) {
  server.json('GET', filePaths.content(org, id, file.path), file)
  const held = heldFetch(server)
  const files = await startedFiles(server, held)
  const view = mountRoot()
  view.render(
    <FilePage
      files={files}
      layout="desktop"
      navigation={testNavigation()}
      tab={{ kind: 'file', path: file.path, mode: 'preview' }}
    />,
  )
  await act(async () => {
    await held.release()
  })
  return { view, held }
}

/** The picture on the page, with the size that its box gives the styles. */
export function pictureOf(container: HTMLElement) {
  const image = container.querySelector('img')
  const box = image?.parentElement
  if (!image || !box) return null
  return {
    alt: image.alt,
    src: image.getAttribute('src'),
    width: box.style.getPropertyValue('--picture-width'),
    ratio: box.style.getPropertyValue('--picture-ratio'),
  }
}

/** Each control that starts a download, and the state of Copy. */
export function controls(container: HTMLElement) {
  const names = [...container.querySelectorAll('button')].map((button) => ({
    name: accessibleName(button),
    off: button.disabled,
  }))
  const copy = names.find(({ name }) => name.startsWith('Copy'))
  return {
    downloads: names
      .map(({ name }) => name)
      .filter((name) => name.startsWith('Download')),
    copy: copy?.off === false ? 'on' : 'off',
  }
}

export function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('h2')].map((h2) => h2.textContent ?? '')
}
