import type { ChangesResponse } from '../../src/shared/generated/ChangesResponse'
import type { FileTreeResponse } from '../../src/shared/generated/FileTreeResponse'
import { isRecord } from '../http'
import { invalidFileResponse } from './errors'
import { natural, parseChanges, parseTree } from './parsers'

export interface FilesStorage {
  get(key: string): Promise<unknown>
  getMany(keys: readonly string[]): Promise<ReadonlyMap<string, unknown>>
  /** All updates and removals commit together. */
  write(
    updates: Readonly<Record<string, unknown>>,
    removals: readonly string[],
  ): Promise<void>
}

export interface StoredFiles {
  connectionId: string | null
  hasSnapshot: boolean
  tree: FileTreeResponse | null
  changes: ChangesResponse | null
}

interface Manifest {
  connectionId: string | null
  hasSnapshot: boolean
  treeChunks: number
  changesChunks: number
}

const KEY = 'files:state:v1'
// A chunk stays below the SQLite Durable Object value limit, including UTF-8 expansion.
const CHUNK_CHARACTERS = 65_536

export function durableFilesStorage(
  storage: Pick<DurableObjectStorage, 'get' | 'transaction'>,
): FilesStorage {
  return {
    get: (key) => storage.get<unknown>(key),
    async getMany(keys) {
      const values = new Map<string, unknown>()
      for (let index = 0; index < keys.length; index += 64) {
        const chunk = await storage.get<unknown>(keys.slice(index, index + 64))
        for (const [key, value] of chunk) values.set(key, value)
      }
      return values
    },
    write: (updates, removals) =>
      storage.transaction(async (transaction) => {
        for (const [key, value] of Object.entries(updates))
          await transaction.put(key, value)
        for (const key of removals) await transaction.delete(key)
      }),
  }
}

async function manifest(storage: FilesStorage): Promise<Manifest> {
  const value = await storage.get(KEY)
  if (value === undefined)
    return {
      connectionId: null,
      hasSnapshot: false,
      treeChunks: 0,
      changesChunks: 0,
    }
  if (
    !isRecord(value) ||
    (value.connectionId !== null && typeof value.connectionId !== 'string') ||
    typeof value.hasSnapshot !== 'boolean' ||
    !natural(value.treeChunks) ||
    !natural(value.changesChunks)
  )
    throw invalidFileResponse()
  return {
    connectionId: value.connectionId,
    hasSnapshot: value.hasSnapshot,
    treeChunks: value.treeChunks,
    changesChunks: value.changesChunks,
  }
}

async function readChunks(
  storage: FilesStorage,
  kind: 'tree' | 'changes',
  count: number,
): Promise<unknown> {
  const chunks: string[] = []
  const keys = Array.from(
    { length: count },
    (_, index) => `${KEY}:${kind}:${index}`,
  )
  const values = await storage.getMany(keys)
  for (let index = 0; index < count; index++) {
    const chunk = values.get(keys[index])
    if (typeof chunk !== 'string') throw invalidFileResponse()
    chunks.push(chunk)
  }
  try {
    return JSON.parse(chunks.join(''))
  } catch {
    throw invalidFileResponse()
  }
}

export async function loadFiles(storage: FilesStorage): Promise<StoredFiles> {
  const stored = await manifest(storage)
  return {
    connectionId: stored.connectionId,
    hasSnapshot: stored.hasSnapshot,
    tree:
      stored.treeChunks === 0
        ? null
        : parseTree(await readChunks(storage, 'tree', stored.treeChunks)),
    changes:
      stored.changesChunks === 0
        ? null
        : parseChanges(
            await readChunks(storage, 'changes', stored.changesChunks),
          ),
  }
}

export async function saveFiles(
  storage: FilesStorage,
  state: StoredFiles,
): Promise<void> {
  const previous = await manifest(storage)
  const updates: Record<string, unknown> = {}
  const removals: string[] = []
  const counts = { treeChunks: 0, changesChunks: 0 }
  for (const kind of ['tree', 'changes'] as const) {
    const text = state[kind] === null ? '' : JSON.stringify(state[kind])
    const count = Math.ceil(text.length / CHUNK_CHARACTERS)
    counts[`${kind}Chunks`] = count
    for (let index = 0; index < count; index++) {
      updates[`${KEY}:${kind}:${index}`] = text.slice(
        index * CHUNK_CHARACTERS,
        (index + 1) * CHUNK_CHARACTERS,
      )
    }
    for (let index = count; index < previous[`${kind}Chunks`]; index++)
      removals.push(`${KEY}:${kind}:${index}`)
  }
  updates[KEY] = {
    connectionId: state.connectionId,
    hasSnapshot: state.hasSnapshot,
    ...counts,
  }
  await storage.write(updates, removals)
}
