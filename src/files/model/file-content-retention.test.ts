import { expect, it } from 'vitest'
import type { FileEntry } from '../../shared/generated/FileEntry'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { FAKE_FILE_PATH, toolFixtures } from '../../test-support/fixtures/tools'
import {
  envelopeAfter,
  filesFor,
  slow,
  startFiles,
  waitUntil,
} from '../files-test-kit'
import { followPath } from './follow-path'
import { ResourceLoader } from './resource-loader'

it(
  'rereads an open file and diff after an upsert with equal tree fields',
  slow,
  async () => {
    const server = new FakeApiServer()
    const data = toolFixtures()
    const path = FAKE_FILE_PATH
    const entry: FileEntry = {
      path,
      name: 'AddressForm.tsx',
      kind: 'file',
      change: 'modified',
    }
    server.json('GET', filePaths.tree(FAKE_IDS.org, FAKE_IDS.workspace), {
      revision: 1,
      entries: [entry],
    })
    const afterRecorded = server.events.history().throughEventNumber
    const files = filesFor(server, (after, listener) =>
      server.events.subscribe(Math.max(after, afterRecorded), listener),
    )
    const file = new ResourceLoader((key, signal) =>
      files.client.readFile(key, signal),
    )
    const diff = new ResourceLoader((key, signal) =>
      files.client.readDiff(key, signal),
    )
    await startFiles(files)
    const stopFile = followPath(files, file, path)
    const stopDiff = followPath(files, diff, path)
    try {
      await waitUntil(() => {
        expect(file.getSnapshot()).toMatchObject({
          status: 'ready',
          value: { content: data.content.content },
        })
        expect(diff.getSnapshot()).toMatchObject({
          status: 'ready',
          value: { newContent: data.diff.newContent },
        })
      })
      server.json(
        'GET',
        filePaths.content(FAKE_IDS.org, FAKE_IDS.workspace, path),
        { ...data.content, content: 'second edit\n', sizeBytes: 12 },
      )
      server.json(
        'GET',
        filePaths.diff(FAKE_IDS.org, FAKE_IDS.workspace, path),
        {
          ...data.diff,
          newContent: 'second edit\n',
          patch: '@@ -1 +1 @@\n-first edit\n+second edit\n',
        },
      )
      server.events.emit(
        envelopeAfter(server, {
          type: 'files.changed',
          delta: { revision: 2, changes: [{ operation: 'upsert', entry }] },
        }),
      )
      expect(files.getSnapshot().tree?.revision).toBe(2)
      expect(files.getSnapshot().versions.get(path)).toBe(1)
      await waitUntil(() => {
        expect(file.getSnapshot()).toMatchObject({
          status: 'ready',
          value: { content: 'second edit\n' },
          refreshing: false,
        })
        expect(diff.getSnapshot()).toMatchObject({
          status: 'ready',
          value: { newContent: 'second edit\n' },
          refreshing: false,
        })
      })
    } finally {
      stopFile()
      stopDiff()
      files.stop()
    }
  },
)
