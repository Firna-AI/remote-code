import { expect, it, onTestFinished } from 'vitest'
import type { ChangesResponse } from '../../shared/generated/ChangesResponse'
import { filePaths } from '../../shared/files'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { toolFixtures } from '../../test-support/fixtures/tools'
import { filesFor, slow, startFiles } from '../files-test-kit'
import type { FilesSubscribe } from './files-store'

it(
  'keeps unpushed and raw file counts from route reads, history, and live count-only updates, also with an empty net list, without inventing legacy counts',
  slow,
  async () => {
    const server = new FakeApiServer()
    const changes = toolFixtures().changes
    const path = filePaths.changes(FAKE_IDS.org, FAKE_IDS.workspace)
    server.json('GET', path, {
      ...changes,
      unpushedCommits: 4,
      uncommittedFileCount: 3,
    })
    let send: Parameters<FilesSubscribe>[1] = () => {}
    const files = filesFor(server, (_after, listener) => {
      send = listener
      return () => {}
    })
    onTestFinished(() => files.stop())
    await startFiles(files)
    expect(files.getSnapshot().changes).toMatchObject({
      unpushedCommits: 4,
      uncommittedFileCount: 3,
    })
    // An edit back to the base content leaves the net list empty. Git status
    // still holds the file, so the raw count does too.
    const restored = { files: [], summary: { files: 0, added: 0, removed: 0 } }
    const envelope = (
      eventNumber: number,
      counts: Pick<ChangesResponse, 'unpushedCommits' | 'uncommittedFileCount'>,
      net: Pick<ChangesResponse, 'files' | 'summary'> = changes,
    ) => ({
      workspaceId: FAKE_IDS.workspace,
      eventNumber,
      occurredAt: FAKE_TIME,
      event: {
        type: 'changes.updated',
        changes: {
          baseBranch: changes.baseBranch,
          files: net.files,
          summary: net.summary,
          ...counts,
        },
      },
    })
    send({
      type: 'history',
      history: {
        events: [envelope(1, { unpushedCommits: 2, uncommittedFileCount: 2 })],
        throughEventNumber: 1,
      },
    })
    expect(files.getSnapshot().changes).toMatchObject({
      unpushedCommits: 2,
      uncommittedFileCount: 2,
    })
    send({
      type: 'event',
      envelope: envelope(2, { unpushedCommits: 0, uncommittedFileCount: 2 }),
    })
    expect(files.getSnapshot().changes).toMatchObject({
      unpushedCommits: 0,
      uncommittedFileCount: 2,
    })
    send({
      type: 'event',
      envelope: envelope(
        3,
        { unpushedCommits: 0, uncommittedFileCount: 1 },
        restored,
      ),
    })
    expect(files.getSnapshot().changes).toMatchObject({
      ...restored,
      unpushedCommits: 0,
      uncommittedFileCount: 1,
    })
    // Only the raw count changes, and the store still takes the report.
    send({
      type: 'event',
      envelope: envelope(
        4,
        { unpushedCommits: 0, uncommittedFileCount: 0 },
        restored,
      ),
    })
    expect(files.getSnapshot().changes).toMatchObject({
      ...restored,
      unpushedCommits: 0,
      uncommittedFileCount: 0,
    })
    send({ type: 'event', envelope: envelope(5, {}) })
    expect(files.getSnapshot().changes).not.toHaveProperty('unpushedCommits')
    expect(files.getSnapshot().changes).not.toHaveProperty(
      'uncommittedFileCount',
    )
  },
)
