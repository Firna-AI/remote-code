import type { FileEntry } from '../../shared/generated/FileEntry'
import { splitPath } from '../navigation'
import type { FileTree } from './tree-model'

/** One visible row of the All files tree. */
export interface TreeRow {
  entry: FileEntry
  depth: number
  /** A folder shows the entries inside it. Always false for a file. */
  expanded: boolean
}

interface TreeIndex {
  children: ReadonlyMap<string, readonly FileEntry[]>
  /** Folders that hold an added or changed entry at any depth. */
  changedFolders: ReadonlySet<string>
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Folders first, then files, by name as people read it. */
function compareEntries(left: FileEntry, right: FileEntry): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  const order = collator.compare(left.name, right.name)
  if (order !== 0) return order
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

function parentOf(path: string): string {
  return splitPath(path).folder
}

/** The name of a folder row when no record names the folder. */
const unknownFolderName = 'Folder'

/**
 * The name of a folder that the tree lacks, from an entry inside it. An
 * entry without a display path holds no secret value, so the real name
 * shows. Else the name is the part of the entry's label at the depth of the
 * folder, when the label has as many parts as the path.
 */
function folderName(folder: string, inside: FileEntry): string {
  if (inside.displayPath === undefined) return splitPath(folder).name
  const parts = inside.displayPath.split('/')
  const depth = folder.split('/').length
  if (parts.length !== inside.path.split('/').length) return unknownFolderName
  return parts[depth - 1] ?? unknownFolderName
}

const indexes = new WeakMap<FileTree, TreeIndex>()

function indexOf(tree: FileTree): TreeIndex {
  const cached = indexes.get(tree)
  if (cached) return cached
  const children = new Map<string, FileEntry[]>()
  const known = new Set(tree.entries.keys())
  const changedFolders = new Set<string>()
  const add = (entry: FileEntry) => {
    const parent = parentOf(entry.path)
    const list = children.get(parent)
    if (list) list.push(entry)
    else children.set(parent, [entry])
  }
  for (const entry of tree.entries.values()) {
    add(entry)
    // An entry whose folder the tree lacks still shows, inside that folder.
    for (let folder = parentOf(entry.path); folder !== '';) {
      if (known.has(folder)) break
      known.add(folder)
      const name = folderName(folder, entry)
      add({ path: folder, name, kind: 'directory', change: null })
      folder = parentOf(folder)
    }
    if (entry.change === null) continue
    for (let folder = parentOf(entry.path); folder !== '';) {
      if (changedFolders.has(folder)) break
      changedFolders.add(folder)
      folder = parentOf(folder)
    }
  }
  for (const list of children.values()) list.sort(compareEntries)
  const index = { children, changedFolders }
  indexes.set(tree, index)
  return index
}

function ancestorsOf(path: string | null): Set<string> {
  const folders = new Set<string>()
  for (let folder = path ? parentOf(path) : ''; folder !== '';) {
    folders.add(folder)
    folder = parentOf(folder)
  }
  return folders
}

/**
 * The rows that show. A folder opens when the user opened it. Until the
 * user toggles it, a folder is open when it holds a changed entry or the
 * open file, so each change and the open file show at first.
 */
export function treeRows(
  tree: FileTree,
  folders: ReadonlyMap<string, boolean>,
  openPath: string | null,
): TreeRow[] {
  const index = indexOf(tree)
  const openFolders = ancestorsOf(openPath)
  const isOpen = (path: string) =>
    folders.get(path) ??
    (index.changedFolders.has(path) || openFolders.has(path))
  const rows: TreeRow[] = []
  const visit = (parent: string, depth: number) => {
    for (const entry of index.children.get(parent) ?? []) {
      const expanded = entry.kind === 'directory' && isOpen(entry.path)
      rows.push({ entry, depth, expanded })
      if (expanded) visit(entry.path, depth + 1)
    }
  }
  visit('', 0)
  return rows
}
