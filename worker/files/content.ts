import type { DiffResponse } from '../../src/shared/generated/DiffResponse'
import type { FileResponse } from '../../src/shared/generated/FileResponse'
import { isRecord } from '../http'
import { FileTooLargeError, invalidFileResponse } from './errors'
import { natural } from './parsers'

export function fileBytes(
  file: FileResponse,
  maxBytes?: number,
): Uint8Array<ArrayBuffer> {
  if (file.encoding === 'utf-8')
    return Uint8Array.from(new TextEncoder().encode(file.content))
  if (
    file.content.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)
  ) {
    throw invalidFileResponse()
  }
  const padding = file.content.endsWith('==')
    ? 2
    : file.content.endsWith('=')
      ? 1
      : 0
  const size = (file.content.length / 4) * 3 - padding
  if (maxBytes !== undefined && size > maxBytes)
    throw new FileTooLargeError(size, maxBytes)
  try {
    return Uint8Array.from(atob(file.content), (character) =>
      character.charCodeAt(0),
    )
  } catch {
    throw invalidFileResponse()
  }
}

export function parseFile(
  value: unknown,
  path: string,
  maxBytes: number,
): FileResponse {
  if (
    !isRecord(value) ||
    value.path !== path ||
    typeof value.mediaType !== 'string' ||
    !value.mediaType ||
    /[\r\n]/.test(value.mediaType) ||
    !natural(value.sizeBytes) ||
    (value.encoding !== 'utf-8' && value.encoding !== 'base64') ||
    typeof value.content !== 'string'
  )
    throw invalidFileResponse()
  if (value.sizeBytes > maxBytes)
    throw new FileTooLargeError(value.sizeBytes, maxBytes)
  const file: FileResponse = {
    path,
    ...(typeof value.displayPath === 'string'
      ? { displayPath: value.displayPath }
      : {}),
    mediaType: value.mediaType,
    sizeBytes: value.sizeBytes,
    encoding: value.encoding,
    content: value.content,
  }
  const size = fileBytes(file, maxBytes).byteLength
  if (size > maxBytes) throw new FileTooLargeError(size, maxBytes)
  if (size !== file.sizeBytes) throw invalidFileResponse()
  return file
}

export function parseDiff(
  value: unknown,
  path: string,
  defaultBranch: string,
): DiffResponse {
  if (
    !isRecord(value) ||
    value.path !== path ||
    value.baseBranch !== defaultBranch ||
    (value.oldContent !== null && typeof value.oldContent !== 'string') ||
    (value.newContent !== null && typeof value.newContent !== 'string') ||
    typeof value.patch !== 'string' ||
    typeof value.binary !== 'boolean'
  )
    throw invalidFileResponse()
  return {
    path,
    ...(typeof value.displayPath === 'string'
      ? { displayPath: value.displayPath }
      : {}),
    baseBranch: defaultBranch,
    ...(typeof value.displayBaseBranch === 'string'
      ? { displayBaseBranch: value.displayBaseBranch }
      : {}),
    oldContent: value.oldContent,
    newContent: value.newContent,
    patch: value.patch,
    binary: value.binary,
  }
}
