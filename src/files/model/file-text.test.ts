import { expect, it } from 'vitest'
import type { FileResponse } from '../../shared/generated/FileResponse'
import { fileText } from './file-text'

function readText(
  encoding: FileResponse['encoding'],
  content: string,
  sizeBytes: number,
) {
  return fileText({
    path: 'note.txt',
    mediaType: 'text/plain',
    sizeBytes,
    encoding,
    content,
  })
}

it('keeps all leading BOMs in original text and removes one from view text', () => {
  const cases = [
    ['utf-8', '\uFEFF# Hi\n', 8, '\uFEFF# Hi\n', '# Hi\n'],
    ['base64', '77u/IyBIaQo=', 8, '\uFEFF# Hi\n', '# Hi\n'],
    ['utf-8', '\uFEFF\uFEFF# Hi\n', 11, '\uFEFF\uFEFF# Hi\n', '\uFEFF# Hi\n'],
    ['base64', '77u/77u/IyBIaQo=', 11, '\uFEFF\uFEFF# Hi\n', '\uFEFF# Hi\n'],
  ] as const
  for (const [encoding, content, sizeBytes, text, viewText] of cases) {
    expect(readText(encoding, content, sizeBytes), content).toEqual({
      kind: 'text',
      text,
      viewText,
    })
  }
})

it('keeps empty text and text without a leading BOM unchanged in the view', () => {
  const cases = [
    ['utf-8', '', 0, ''],
    ['base64', '', 0, ''],
    ['utf-8', 'hi\uFEFF\n', 6, 'hi\uFEFF\n'],
    ['base64', 'aGnvu78K', 6, 'hi\uFEFF\n'],
    ['utf-8', 'café', 5, 'café'],
    ['base64', 'Y2Fmw6k=', 5, 'café'],
  ] as const
  for (const [encoding, content, sizeBytes, text] of cases) {
    expect(readText(encoding, content, sizeBytes), content).toEqual({
      kind: 'text',
      text,
      viewText: text,
    })
  }
})

it('keeps invalid base64, invalid UTF-8, and NUL content binary', () => {
  const cases = [
    ['base64', '!!!!', 0],
    ['base64', 'wyg=', 2],
    ['utf-8', 'hi\u0000', 3],
    ['base64', 'aGkA', 3],
  ] as const
  for (const [encoding, content, sizeBytes] of cases) {
    expect(readText(encoding, content, sizeBytes), content).toEqual({
      kind: 'binary',
    })
  }
})
