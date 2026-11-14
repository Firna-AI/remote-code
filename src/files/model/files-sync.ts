import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import type { FileTreeDelta } from '../../shared/generated/FileTreeDelta'
import type { FileTreeResponse } from '../../shared/generated/FileTreeResponse'
import type { FileEvent } from '../../shared/files'
import { applyTreeDelta, treeFromSnapshot, type FileTree } from './tree-model'

/**
 * The tree and the changes, merged from the file routes and the event
 * stream. The stream is in event order, so after it gives a value, an
 * older read of the route cannot replace that value.
 */
export interface FilesSync {
  tree: FileTree | null
  treeFromStream: boolean
  /**
   * The cloud computer could not read the files. The tree is the saved one,
   * or empty when none was saved, and its entries can be out of date. Only a
   * full tree of the stream clears the mark. A tree update and a reply of
   * the tree route clear nothing.
   */
  treeUnavailable: boolean
  /** Updates that wait for a tree, or for a tree read after a gap. */
  pending: readonly FileTreeDelta[]
  /** An update skipped a revision, so the tree must be read again. */
  treeStale: boolean
  changes: ChangesResponse | null
  changesFromStream: boolean
}

/** A merge result, with the paths whose content may have changed. */
export interface SyncStep {
  sync: FilesSync
  touched: ReadonlySet<string>
  /** The affected paths cannot be named, so any file may have changed. */
  allTouched: boolean
}

export const emptySync: FilesSync = {
  tree: null,
  treeFromStream: false,
  treeUnavailable: false,
  pending: [],
  treeStale: false,
  changes: null,
  changesFromStream: false,
}

const none: ReadonlySet<string> = new Set()

function unchanged(sync: FilesSync): SyncStep {
  return { sync, touched: none, allTouched: false }
}

function unknownPaths(sync: FilesSync): SyncStep {
  return { sync, touched: none, allTouched: true }
}

/** Applies the waiting updates that are newer than the tree, in order. */
function withPending(tree: FileTree, pending: readonly FileTreeDelta[]) {
  let current = tree
  const ordered = [...pending].sort((a, b) => a.revision - b.revision)
  for (const delta of ordered) {
    if (delta.revision > current.revision) {
      current = applyTreeDelta(current, delta).tree
    }
  }
  return current
}

/**
 * The paths of both change lists. A new change list can change any diff,
 * also one with the same line counts, such as after the default branch
 * moves. So every listed path counts as touched.
 */
function listedPaths(
  before: ChangesResponse | null,
  after: ChangesResponse,
): ReadonlySet<string> {
  if (!before) return none
  const touched = new Set<string>()
  for (const file of [...before.files, ...after.files]) {
    touched.add(file.path)
    if (file.previousPath) touched.add(file.previousPath)
  }
  return touched
}

export function syncFetchedTree(
  sync: FilesSync,
  response: FileTreeResponse,
): SyncStep {
  if (sync.treeFromStream && !sync.treeStale) return unchanged(sync)
  const tree = withPending(treeFromSnapshot(response), sync.pending)
  // A reply can be older than a mark of the stream, so it only adds one.
  const treeUnavailable = sync.treeUnavailable || response.unavailable === true
  return {
    sync: { ...sync, tree, treeUnavailable, pending: [], treeStale: false },
    touched: none,
    allTouched: sync.tree !== null,
  }
}

export function syncFetchedChanges(
  sync: FilesSync,
  changes: ChangesResponse,
): SyncStep {
  if (sync.changesFromStream) return unchanged(sync)
  return {
    sync: { ...sync, changes },
    touched: listedPaths(sync.changes, changes),
    allTouched: false,
  }
}

function syncDelta(sync: FilesSync, delta: FileTreeDelta): SyncStep {
  const { tree } = sync
  if (!tree || sync.treeStale) {
    return unknownPaths({ ...sync, pending: [...sync.pending, delta] })
  }
  if (delta.revision <= tree.revision) return unknownPaths(sync)
  if (delta.revision > tree.revision + 1) {
    return unknownPaths({
      ...sync,
      pending: [...sync.pending, delta],
      treeStale: true,
    })
  }
  const step = applyTreeDelta(tree, delta)
  return {
    sync: { ...sync, tree: step.tree },
    touched: step.touched,
    allTouched: false,
  }
}

/** Applies one file event of the stream, in event order. */
export function syncEvent(sync: FilesSync, event: FileEvent): SyncStep {
  switch (event.type) {
    case 'files.snapshot':
      return {
        sync: {
          ...sync,
          tree: treeFromSnapshot(event.tree),
          treeFromStream: true,
          treeUnavailable: event.tree.unavailable === true,
          pending: [],
          treeStale: false,
        },
        touched: none,
        allTouched: true,
      }
    case 'files.changed':
      return syncDelta(sync, event.delta)
    case 'files.unavailable':
      // The saved tree stays, and no file content changes.
      return unchanged({ ...sync, treeUnavailable: true })
    case 'changes.updated':
      return {
        sync: { ...sync, changes: event.changes, changesFromStream: true },
        touched: listedPaths(sync.changes, event.changes),
        allTouched: sync.changes === null,
      }
  }
}
