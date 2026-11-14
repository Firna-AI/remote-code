import type { BranchChangedFile } from '../../shared/generated/BranchChangedFile'
import type { ChangeKind } from '../../shared/generated/ChangeKind'
import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import type { DiffResponse } from '../../shared/generated/DiffResponse'
import type { FileResponse } from '../../shared/generated/FileResponse'
import {
  isObject,
  parseItems,
  readArray,
  readCount,
  readLabel,
  readString,
} from './guards'

const changeKinds: readonly ChangeKind[] = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'untracked',
]

export function parseChangeKind(value: unknown): ChangeKind | null {
  return changeKinds.find((kind) => kind === value) ?? null
}

function parseChangedFile(value: unknown): BranchChangedFile | null {
  if (!isObject(value)) return null
  const path = readString(value, 'path')
  const change = parseChangeKind(value.change)
  const added = readCount(value, 'added')
  const removed = readCount(value, 'removed')
  if (!path || !change || added === null || removed === null) return null
  const previousPath = readString(value, 'previousPath')
  return {
    path,
    ...readLabel(value, 'displayPath'),
    ...(previousPath
      ? { previousPath, ...readLabel(value, 'previousDisplayPath') }
      : {}),
    change,
    added,
    removed,
    uncommitted: value.uncommitted === true,
  }
}

/** The changes of the branch. Files that do not parse are left out. */
export function parseChanges(value: unknown): ChangesResponse | null {
  if (!isObject(value)) return null
  const baseBranch = readString(value, 'baseBranch')
  const files = readArray(value, 'files')
  const summary = isObject(value.summary) ? value.summary : null
  if (baseBranch === null || files === null || !summary) return null
  const count = readCount(summary, 'files')
  const added = readCount(summary, 'added')
  const removed = readCount(summary, 'removed')
  if (count === null || added === null || removed === null) return null
  const unpushedCommits = readCount(value, 'unpushedCommits')
  if (value.unpushedCommits !== undefined && unpushedCommits === null)
    return null
  const uncommittedFileCount = readCount(value, 'uncommittedFileCount')
  if (value.uncommittedFileCount !== undefined && uncommittedFileCount === null)
    return null
  return {
    baseBranch,
    ...(unpushedCommits === null ? {} : { unpushedCommits }),
    ...(uncommittedFileCount === null ? {} : { uncommittedFileCount }),
    ...readLabel(value, 'displayBaseBranch'),
    files: parseItems(files, parseChangedFile),
    summary: { files: count, added, removed },
  }
}

export function parseFileResponse(value: unknown): FileResponse | null {
  if (!isObject(value)) return null
  const path = readString(value, 'path')
  const mediaType = readString(value, 'mediaType')
  const sizeBytes = readCount(value, 'sizeBytes')
  const content = readString(value, 'content')
  const encoding = value.encoding
  if (!path || mediaType === null || sizeBytes === null || content === null) {
    return null
  }
  if (encoding !== 'utf-8' && encoding !== 'base64') return null
  return {
    path,
    ...readLabel(value, 'displayPath'),
    mediaType,
    sizeBytes,
    encoding,
    content,
  }
}

function readText(value: unknown): string | null | undefined {
  if (value === null || typeof value === 'string') return value
  return undefined
}

export function parseDiffResponse(value: unknown): DiffResponse | null {
  if (!isObject(value)) return null
  const path = readString(value, 'path')
  const baseBranch = readString(value, 'baseBranch')
  const patch = readString(value, 'patch')
  const oldContent = readText(value.oldContent)
  const newContent = readText(value.newContent)
  if (!path || baseBranch === null || patch === null) return null
  if (oldContent === undefined || newContent === undefined) return null
  if (typeof value.binary !== 'boolean') return null
  return {
    path,
    ...readLabel(value, 'displayPath'),
    baseBranch,
    ...readLabel(value, 'displayBaseBranch'),
    oldContent,
    newContent,
    patch,
    binary: value.binary,
  }
}
