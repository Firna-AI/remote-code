import { afterAll, beforeAll, expect, it } from 'vitest'
import type { FileEntry } from '../../src/shared/generated/FileEntry'
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

it('accepts and retains a content update whose tree entry stays equal', async () => {
  const name = 'equal-entry-content-update'
  const state = new FilesState(runtime.storage(name))
  const entry: FileEntry = {
    path: 'README.md',
    name: 'README.md',
    kind: 'file',
    change: 'modified',
  }
  await state.beginConnection('runner')
  await state.apply('runner', {
    type: 'files.snapshot',
    tree: { revision: 1, entries: [entry] },
  })
  expect(
    await state.apply('runner', {
      type: 'files.changed',
      delta: { revision: 2, changes: [{ operation: 'upsert', entry }] },
    }),
  ).toBe(true)
  await runtime.evict(name)
  const reloaded = new FilesState(runtime.storage(name))
  expect(await reloaded.tree()).toEqual({ revision: 2, entries: [entry] })
})
