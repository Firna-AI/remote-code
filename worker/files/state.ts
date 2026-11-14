import type { ChangesResponse } from '../../src/shared/generated/ChangesResponse'
import type { FileTreeResponse } from '../../src/shared/generated/FileTreeResponse'
import { parseFileEvent } from './parsers'
import {
  loadFiles,
  saveFiles,
  type FilesStorage,
  type StoredFiles,
} from './storage'

export class FilesState {
  private readonly storage: FilesStorage
  private queue: Promise<unknown> = Promise.resolve()

  constructor(storage: FilesStorage) {
    this.storage = storage
  }

  /** The owner supplies a fresh ID for each accepted physical connection. */
  beginConnection(connectionId: string): Promise<void> {
    return this.serialize(async () => {
      const state = await this.load()
      await saveFiles(this.storage, {
        ...state,
        connectionId,
        hasSnapshot: false,
      })
    })
  }

  /** Call only after the owner accepts the envelope in contiguous event order. */
  apply(connectionId: string, value: unknown): Promise<boolean> {
    return this.serialize(async () => {
      const state = await this.load()
      if (state.connectionId !== connectionId) return false
      const event = parseFileEvent(value)
      if (event.type === 'files.unavailable') {
        state.tree = {
          ...(state.tree ?? { revision: 0, entries: [] }),
          unavailable: true,
        }
      } else if (event.type === 'changes.updated') {
        state.changes = event.changes
      } else if (event.type === 'files.snapshot') {
        if (
          state.hasSnapshot &&
          state.tree &&
          event.tree.revision <= state.tree.revision
        )
          return false
        state.tree = event.tree
        state.hasSnapshot = true
      } else {
        if (
          !state.hasSnapshot ||
          !state.tree ||
          event.delta.revision <= state.tree.revision
        )
          return false
        const entries = new Map(
          state.tree.entries.map((entry) => [entry.path, entry]),
        )
        for (const change of event.delta.changes) {
          if (change.operation === 'remove') {
            for (const path of entries.keys()) {
              if (path === change.path || path.startsWith(`${change.path}/`))
                entries.delete(path)
            }
          } else {
            if (change.operation === 'move') entries.delete(change.previousPath)
            entries.set(change.entry.path, change.entry)
          }
        }
        state.tree = {
          revision: event.delta.revision,
          entries: [...entries.values()],
          ...(state.tree.unavailable ? { unavailable: true } : {}),
        }
      }
      await saveFiles(this.storage, state)
      return true
    })
  }

  tree(): Promise<FileTreeResponse | null> {
    return this.serialize(async () => (await this.load()).tree)
  }

  changes(): Promise<ChangesResponse | null> {
    return this.serialize(async () => (await this.load()).changes)
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async load(): Promise<StoredFiles> {
    return loadFiles(this.storage)
  }
}
