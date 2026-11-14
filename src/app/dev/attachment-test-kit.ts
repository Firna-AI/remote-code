import { Buffer } from 'node:buffer'
import { expect, vi } from 'vitest'
import type { FileResponse } from '../../shared/generated/FileResponse'
import type { Attachment } from '../../shared/generated/Attachment'
import type { FilesResult } from '../../files/api/files-errors'
import { FAKE_ORIGIN, FAKE_TIME } from '../../test-support/fixtures/core'

export function setupDevWindow(): void {
  vi.useFakeTimers()
  vi.setSystemTime(FAKE_TIME)
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    navigator: { userAgent: 'Development API test' },
    document: { visibilityState: 'visible' },
    location: { origin: FAKE_ORIGIN },
  })
}

export function resetDevWindow(): void {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
}

export function uploadHooks() {
  return {
    signal: new AbortController().signal,
    live: () => true,
    progress: () => {},
  }
}

export function copyPath(attachment: Attachment): string {
  if (attachment.path === null) throw new Error('The upload has no path.')
  return attachment.path
}

export function imageFile(): File {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA9sAAAAASUVORK5CYII='
  return new File(
    [Uint8Array.from(atob(png), (char) => char.charCodeAt(0))],
    'My screen.png',
    { type: 'image/png' },
  )
}

export async function expectCopiedFile(
  result: FilesResult<FileResponse>,
  original: File,
  path: string,
): Promise<void> {
  expect(result).toMatchObject({
    ok: true,
    value: { path, mediaType: original.type, sizeBytes: original.size },
  })
  if (!result.ok) throw new Error('The copied file could not be read.')
  const bytes =
    result.value.encoding === 'base64'
      ? Uint8Array.from(atob(result.value.content), (char) =>
          char.charCodeAt(0),
        )
      : new TextEncoder().encode(result.value.content)
  expect(Buffer.from(bytes).toString('base64')).toBe(
    Buffer.from(await original.arrayBuffer()).toString('base64'),
  )
}
