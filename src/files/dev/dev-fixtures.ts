import type { DiffResponse } from '../../shared/generated/DiffResponse'
import type { FileEntry } from '../../shared/generated/FileEntry'
import type { FileResponse } from '../../shared/generated/FileResponse'
import type { FileTreeResponse } from '../../shared/generated/FileTreeResponse'
import { autocompleteHook } from '../../../docs/mockups/src/fixtures/fileContents'
import { filePaths, type FileTooLargeResponse } from '../../shared/files'
import { decodeUtf8 } from '../../shared/utf8'
import type { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { toolFixtures } from '../../test-support/fixtures/tools'
import { splitPath } from '../navigation'
import * as samples from './dev-samples'

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

/** The text of each development file, by path. Development only. */
export const devTextFiles: ReadonlyMap<string, string> = new Map([
  ['README.md', samples.readme],
  ['docs/README.md', samples.readme],
  ['src/app/checkout/useAddressAutocomplete.ts', `${autocompleteHook}\n`],
  ['src/app/checkout/AddressForm.tsx', `${samples.addressForm}\n`],
  ['src/app/layout.tsx', samples.layout],
  ['tests/checkout/address.test.ts', samples.addressTest],
  ['next.config.ts', samples.nextConfig],
  ['package.json', samples.packageJson],
  ['tsconfig.json', samples.tsconfig],
  ['.env.example', samples.envExample],
  ['notes.txt', samples.notes],
])

/** The read limit of the development routes. A sample, not product policy. */
const sampleLimitBytes = 1_048_576

/** A 1 × 1 PNG: its file tab shows a picture, and its diff is binary. */
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** A product list over the sample read limit, so the page shows that state. */
function largeCatalog(): Uint8Array<ArrayBuffer> {
  const product = '{"name":"Desk lamp","priceCents":4900}'
  const products = new Array<string>(90_000).fill(product).join(',')
  return new TextEncoder().encode(`{"products":[${products}]}\n`)
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Sets the replies of one file, by its bytes, as the Worker serves them:
 * the content route and the download route read the file with one limit.
 * Over the limit, both routes refuse it with `file_too_large`. UTF-8 text
 * comes as text, and other bytes as base64.
 */
export function registerFile(
  server: FakeApiServer,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  mediaType = 'text/plain',
): void {
  const content = filePaths.content(org, id, path)
  const download = filePaths.download(org, id, path)
  if (bytes.byteLength > sampleLimitBytes) {
    const refusal: FileTooLargeResponse = {
      error: {
        code: 'file_too_large',
        message: 'The file is too large to open.',
        sizeBytes: bytes.byteLength,
        limitBytes: sampleLimitBytes,
      },
    }
    server.json('GET', content, refusal, 413)
    server.json('GET', download, refusal, 413)
    return
  }
  const text = decodeUtf8(bytes)
  const file: FileResponse = {
    path,
    mediaType,
    sizeBytes: bytes.byteLength,
    encoding: text === null ? 'base64' : 'utf-8',
    content: text ?? base64Of(bytes),
  }
  server.json('GET', content, file)
  server.response(
    'GET',
    download,
    new Response(bytes, {
      headers: {
        'Content-Type': mediaType,
        'Content-Disposition': `attachment; filename="${splitPath(path).name}"`,
      },
    }),
  )
}

export function registerDiff(server: FakeApiServer, diff: DiffResponse) {
  server.json('GET', filePaths.diff(org, id, diff.path), diff)
}

function diffOf(
  path: string,
  before: string | null,
  after: string | null,
): DiffResponse {
  const patch =
    before === null
      ? samples.addedPatch(after ?? '')
      : samples.deletedPatch(before)
  return {
    path,
    baseBranch: 'main',
    oldContent: before,
    newContent: after,
    patch,
    binary: false,
  }
}

const readmePatch = `@@ -12,3 +12,6 @@ ## Checkout
-Checkout suggests addresses as you type.
+Checkout suggests addresses as you type. Suggestions come from \`/api/places\`, which needs \`PLACES_API_KEY\`. Without the key, the form falls back to manual entry.
+
+## Tests
+`

const extraEntries: readonly FileEntry[] = [
  { path: 'public/hero.png', name: 'hero.png', kind: 'file', change: null },
  {
    path: 'public/catalog.json',
    name: 'catalog.json',
    kind: 'file',
    change: null,
  },
]

/** The tree of the development page: the mockup files and the samples. */
export function devTree(): FileTreeResponse {
  const tree = toolFixtures().files
  return {
    revision: tree.revision,
    entries: [...tree.entries, ...extraEntries],
  }
}

/**
 * Sets the development replies of the file routes on the fake server:
 * file texts, downloads, diffs, a binary file, a file over the read limit,
 * and a file whose read and download fail.
 */
export function registerDevFiles(server: FakeApiServer): void {
  server.json('GET', filePaths.tree(org, id), devTree())
  const encoder = new TextEncoder()
  for (const [path, text] of devTextFiles) {
    registerFile(server, path, encoder.encode(text))
  }
  const png = Uint8Array.from(atob(pixel), (char) => char.charCodeAt(0))
  registerFile(server, 'public/hero.png', png, 'image/png')
  registerFile(
    server,
    'public/catalog.json',
    largeCatalog(),
    'application/json',
  )
  const unavailable = {
    error: { code: 'file_unavailable', message: 'The file could not be read.' },
  }
  for (const route of [filePaths.content, filePaths.download]) {
    const failing = route(org, id, 'src/app/checkout/page.tsx')
    server.json('GET', failing, unavailable, 503)
  }
  const form = 'src/app/checkout/AddressForm.tsx'
  for (const diff of [
    {
      path: form,
      baseBranch: 'main',
      oldContent: samples.oldAddressForm,
      newContent: samples.addressForm,
      patch: samples.addressFormPatch,
      binary: false,
    },
    {
      ...diffOf('README.md', samples.readme, samples.readme),
      patch: readmePatch,
    },
    {
      ...diffOf('docs/README.md', samples.readme, samples.readme),
      patch: readmePatch,
    },
    diffOf(
      'src/app/checkout/useAddressAutocomplete.ts',
      null,
      autocompleteHook,
    ),
    diffOf('src/app/checkout/postcodeLookup.ts', samples.postcodeLookup, null),
    diffOf('tests/checkout/address.test.ts', null, samples.addressTest),
    diffOf('notes.txt', null, samples.notes),
    diffOf('.env.example', samples.envExample, null),
    {
      path: 'public/hero.png',
      baseBranch: 'main',
      oldContent: null,
      newContent: null,
      patch: '',
      binary: true,
    },
  ]) {
    registerDiff(server, diff)
  }
}
