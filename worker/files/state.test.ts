import { afterAll, beforeAll, expect, it } from 'vitest'
import type { BranchChangedFile } from '../../src/shared/generated/BranchChangedFile'
import type { FileEntry } from '../../src/shared/generated/FileEntry'
import { parseChanges } from '../../src/files/api/parse-changes'
import { recordedRunnerFileEvents } from '../../src/test-support/recorded-files'
import { FilesState } from './state'
import {
  createFilesStorage,
  type FilesStorageHarness,
} from './test-support/storage'

let runtime: FilesStorageHarness
beforeAll(async () => {
  runtime = await createFilesStorage()
})
afterAll(async () => {
  await runtime.dispose()
})

it('stores runner snapshots, tree deltas, and dirty branch changes across durable reload', async () => {
  const storage = runtime.storage('projection-reload')
  const state = new FilesState(storage)
  await state.beginConnection('connection-1')
  for (const event of recordedRunnerFileEvents) {
    if (event.type === 'changes.updated') {
      const changes = { ...event.changes }
      delete changes.uncommittedFileCount
      await state.apply('connection-1', { ...event, changes })
    } else await state.apply('connection-1', event)
  }
  await runtime.evict('projection-reload')
  const reloaded = new FilesState(runtime.storage('projection-reload'))
  expect((await reloaded.tree())?.revision).toBe(2)
  const tree = await reloaded.tree()
  expect(
    tree?.entries.filter((entry) =>
      ['notes.txt', 'docs/README.md', 'README.md', '.env.example'].includes(
        entry.path,
      ),
    ),
  ).toEqual([
    { path: 'notes.txt', name: 'notes.txt', kind: 'file', change: 'untracked' },
    {
      path: 'docs/README.md',
      name: 'README.md',
      kind: 'file',
      change: 'renamed',
    },
  ])
  expect(await reloaded.changes()).toMatchObject({
    baseBranch: 'main',
    summary: { files: 7, added: 161, removed: 50 },
    files: expect.arrayContaining([
      {
        path: 'notes.txt',
        change: 'untracked',
        added: 3,
        removed: 0,
        uncommitted: true,
      },
      {
        path: '.env.example',
        change: 'deleted',
        added: 0,
        removed: 2,
        uncommitted: true,
      },
      expect.objectContaining({
        path: 'docs/README.md',
        previousPath: 'README.md',
        change: 'renamed',
      }),
      expect.objectContaining({ uncommitted: false }),
    ]),
  })
  expect(parseChanges(await reloaded.changes())).not.toHaveProperty(
    'uncommittedFileCount',
  )
})

it('ignores stale trees and old connections and accepts a fresh connection revision', async () => {
  const state = new FilesState(runtime.storage('projection-reconnect'))
  await state.beginConnection('old')
  for (const event of recordedRunnerFileEvents) await state.apply('old', event)
  expect(await state.apply('old', recordedRunnerFileEvents[0])).toBe(false)
  expect(await state.apply('old', recordedRunnerFileEvents[2])).toBe(false)
  await state.beginConnection('new')
  expect(await state.apply('old', recordedRunnerFileEvents[0])).toBe(false)
  expect(await state.apply('new', recordedRunnerFileEvents[2])).toBe(false)
  expect((await state.tree())?.revision).toBe(2)
  expect(await state.apply('new', recordedRunnerFileEvents[0])).toBe(true)
  expect((await state.tree())?.revision).toBe(1)
  await expect(
    state.apply('new', {
      type: 'files.changed',
      delta: { revision: 2, changes: [{ operation: 'upsert', entry: null }] },
    }),
  ).rejects.toMatchObject({ status: 502, code: 'file_unavailable' })
  expect(await state.apply('new', recordedRunnerFileEvents[2])).toBe(true)
  expect((await state.tree())?.revision).toBe(2)
})

it('stores repository trees and changes larger than one Durable Object value', async () => {
  const state = new FilesState(runtime.storage('large-projection'))
  await state.beginConnection('large')
  const entries: FileEntry[] = Array.from({ length: 20_000 }, (_, index) => ({
    path: `src/${'nested-directory/'.repeat(8)}file-${index}.ts`,
    name: `file-${index}.ts`,
    kind: 'file',
    change: 'modified',
  }))
  const files: BranchChangedFile[] = entries.map((entry) => ({
    path: entry.path,
    change: 'modified',
    added: 1,
    removed: 0,
    uncommitted: true,
  }))
  await expect(
    state.apply('large', {
      type: 'files.snapshot',
      tree: { revision: 1, entries },
    }),
  ).resolves.toBe(true)
  await expect(
    state.apply('large', {
      type: 'changes.updated',
      changes: {
        baseBranch: 'main',
        files,
        summary: { files: 20_000, added: 20_000, removed: 0 },
      },
    }),
  ).resolves.toBe(true)
  await runtime.evict('large-projection')
  const reloaded = new FilesState(runtime.storage('large-projection'))
  expect((await reloaded.tree())?.entries).toEqual(entries)
  expect((await reloaded.changes())?.files).toEqual(files)
  console.info(
    'Large projection storage:',
    await runtime.inspect('large-projection'),
  )
})
