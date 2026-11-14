import { expect, it } from 'vitest'
import type { FileResponse } from '../../shared/generated/FileResponse'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { errorFromBody } from '../api/files-errors'
import { parseFileResponse } from '../api/parse-changes'
import { registerDevFiles } from './dev-fixtures'

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

/** The bytes of a content reply, or null when the reply is not a file. */
function bytesOf(file: FileResponse | null): number[] | null {
  if (!file) return null
  return file.encoding === 'base64'
    ? [...atob(file.content)].map((char) => char.charCodeAt(0))
    : [...new TextEncoder().encode(file.content)]
}

it('serves each development file on its content and download routes with one read limit', async () => {
  const server = new FakeApiServer()
  registerDevFiles(server)
  const refusal = async (route: string) => {
    const response = await server.fetch(route)
    const body: unknown = await response.json()
    return {
      status: response.status,
      error: errorFromBody(response.status, body),
    }
  }

  const refused = [
    ['public/catalog.json', 413],
    ['src/app/checkout/page.tsx', 503],
  ] as const
  for (const [path, status] of refused) {
    const content = await refusal(filePaths.content(org, id, path))
    const download = await refusal(filePaths.download(org, id, path))
    expect(content.status, path).toBe(status)
    expect(download, path).toEqual(content)
  }
  const catalog = await refusal(
    filePaths.content(org, id, 'public/catalog.json'),
  )
  expect(catalog.error).toEqual({
    kind: 'too-large',
    sizeBytes: expect.any(Number),
    limitBytes: 1_048_576,
  })

  for (const path of ['README.md', 'public/hero.png']) {
    const content = await server.fetch(filePaths.content(org, id, path))
    const file = parseFileResponse(await content.json())
    const download = await server.fetch(filePaths.download(org, id, path))
    const sent = [...new Uint8Array(await download.arrayBuffer())]
    expect(sent, path).toEqual(bytesOf(file))
  }
})
