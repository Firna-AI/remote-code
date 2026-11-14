import type { FileEntry } from '../../shared/generated/FileEntry'
import type { FileTreeDelta } from '../../shared/generated/FileTreeDelta'
import type { FileTreeResponse } from '../../shared/generated/FileTreeResponse'
import { pathLabel } from './file-labels'

/** The files of the branch at one revision, by repository path. */
export interface FileTree {
  revision: number
  entries: ReadonlyMap<string, FileEntry>
}

export function treeFromSnapshot(snapshot: FileTreeResponse): FileTree {
  return {
    revision: snapshot.revision,
    entries: new Map(snapshot.entries.map((entry) => [entry.path, entry])),
  }
}

function isInside(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`)
}

function removePath(
  entries: Map<string, FileEntry>,
  path: string,
  touched: Set<string>,
): void {
  const entry = entries.get(path)
  entries.delete(path)
  touched.add(path)
  if (entry?.kind === 'file') return
  for (const key of [...entries.keys()]) {
    if (!isInside(key, path)) continue
    entries.delete(key)
    touched.add(key)
  }
}

/**
 * Moves an entry. A folder takes the entries inside it along: their real
 * paths change at once, and each keeps the label that the server gave it,
 * until an update of the entry gives a new one. The browser never joins two
 * labels, because two safe parts can form a secret value.
 */
function movePath(
  entries: Map<string, FileEntry>,
  from: string,
  entry: FileEntry,
  touched: Set<string>,
): void {
  const previous = entries.get(from)
  entries.delete(from)
  touched.add(from)
  if (previous?.kind === 'directory' && entry.kind === 'directory') {
    for (const [key, value] of [...entries]) {
      if (!isInside(key, from)) continue
      const path = entry.path + key.slice(from.length)
      entries.delete(key)
      entries.set(path, { ...value, path, displayPath: pathLabel(value) })
      touched.add(key)
      touched.add(path)
    }
  }
  entries.set(entry.path, entry)
  touched.add(entry.path)
}

/**
 * Applies one tree update in order. A directory move can repeat the moves
 * of the entries inside it, so each move is safe to apply twice.
 */
export function applyTreeDelta(
  tree: FileTree,
  delta: FileTreeDelta,
): { tree: FileTree; touched: ReadonlySet<string> } {
  const entries = new Map(tree.entries)
  const touched = new Set<string>()
  for (const change of delta.changes) {
    switch (change.operation) {
      case 'upsert': {
        // A folder that becomes a file, or the reverse, drops its old entries.
        const existing = entries.get(change.entry.path)
        if (existing && existing.kind !== change.entry.kind) {
          removePath(entries, change.entry.path, touched)
        }
        entries.set(change.entry.path, change.entry)
        touched.add(change.entry.path)
        break
      }
      case 'remove':
        removePath(entries, change.path, touched)
        break
      case 'move':
        movePath(entries, change.previousPath, change.entry, touched)
        break
    }
  }
  return { tree: { revision: delta.revision, entries }, touched }
}
