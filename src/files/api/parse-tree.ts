import type { FileEntry } from '../../shared/generated/FileEntry'
import type { FileTreeChange } from '../../shared/generated/FileTreeChange'
import type { FileTreeDelta } from '../../shared/generated/FileTreeDelta'
import type { FileTreeResponse } from '../../shared/generated/FileTreeResponse'
import {
  isObject,
  parseItems,
  readArray,
  readCount,
  readLabel,
  readString,
} from './guards'
import { parseChangeKind } from './parse-changes'

/**
 * An entry of the tree. `path` stays the real path for each read and key,
 * and `name` and `displayPath` are the labels that hide a secret value.
 */
function parseFileEntry(value: unknown): FileEntry | null {
  if (!isObject(value)) return null
  const path = readString(value, 'path')
  const name = readString(value, 'name')
  const kind = value.kind
  if (!path || name === null) return null
  if (kind !== 'file' && kind !== 'directory') return null
  return {
    path,
    ...readLabel(value, 'displayPath'),
    name,
    kind,
    change: parseChangeKind(value.change),
  }
}

/**
 * A full tree. Entries that do not parse are left out. Only the value true
 * of `unavailable` marks a tree that the cloud computer could not read: its
 * entries are the saved tree, or none when no tree was saved.
 */
export function parseFileTree(value: unknown): FileTreeResponse | null {
  if (!isObject(value)) return null
  const revision = readCount(value, 'revision')
  const entries = readArray(value, 'entries')
  if (revision === null || entries === null) return null
  return {
    revision,
    entries: parseItems(entries, parseFileEntry),
    ...(value.unavailable === true ? { unavailable: true } : {}),
  }
}

function parseTreeChange(value: unknown): FileTreeChange | null {
  if (!isObject(value)) return null
  if (value.operation === 'remove') {
    const path = readString(value, 'path')
    return path ? { operation: 'remove', path } : null
  }
  const entry = parseFileEntry(value.entry)
  if (!entry) return null
  if (value.operation === 'upsert') return { operation: 'upsert', entry }
  const previousPath = readString(value, 'previousPath')
  if (value.operation === 'move' && previousPath) {
    return { operation: 'move', previousPath, entry }
  }
  return null
}

export function parseTreeDelta(value: unknown): FileTreeDelta | null {
  if (!isObject(value)) return null
  const revision = readCount(value, 'revision')
  const changes = readArray(value, 'changes')
  if (revision === null || changes === null) return null
  return { revision, changes: parseItems(changes, parseTreeChange) }
}
