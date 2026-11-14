import type { FileResponse } from '../../shared/generated/FileResponse'
import { fileText, type FileText } from '../model/file-text'

/**
 * What a file page shows of a read: a picture, text, or the mark of a
 * file that is not text. A picture holds a `data:` address of the bytes
 * of the read, because the content security policy of the apps lets an
 * image load from `data:`, but not from `blob:`.
 */
export type FileView = FileText | { kind: 'picture'; address: string }

/**
 * The media type of each picture format, by the extension of a file name
 * in lower case. An SVG file is not here: it shows its source.
 */
const pictureTypes: ReadonlyMap<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
])

/** The bytes as base64, in steps that keep each `fromCharCode` call short. */
function base64Of(bytes: Uint8Array): string {
  const step = 0x8000
  let binary = ''
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step))
  }
  return btoa(binary)
}

/**
 * The view of the read of `path`, the real path. A PNG, JPEG, GIF, or
 * WebP file is a picture by the extension of its name, whatever media type
 * the read gives, because the reads do not give the right type of each
 * image. Its address holds the bytes of the read, also when the read sent
 * them as text. An empty file stays empty, as it has no bytes to draw.
 * Each other file is its text, or a file that is not text.
 */
export function fileView(path: string, file: FileResponse): FileView {
  const extension = /\.([^./]+)$/.exec(path)?.[1]
  const type = extension && pictureTypes.get(extension.toLowerCase())
  if (!type || file.content === '') return fileText(file)
  const content =
    file.encoding === 'base64'
      ? file.content
      : base64Of(new TextEncoder().encode(file.content))
  return { kind: 'picture', address: `data:${type};base64,${content}` }
}
