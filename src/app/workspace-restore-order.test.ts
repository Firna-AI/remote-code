import type { Workspace } from '../shared/generated/Workspace'
import { describe, expect, test } from 'vitest'

import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import {
  archivedAt,
  paths,
  reply,
  restoredAt,
  stoppedWorkspace,
} from './restore-test-kit'
import { valueOf } from './store'

describe('the order of Archive and Restore in the open workspace', () => {
  test('a Restore stays over the older Archive event that comes after it, and a newer Archive event shows', async () => {
    const { server, workspace, updated, states } = await stoppedWorkspace()
    await workspace.open()
    server.json('POST', paths.archive, reply(archivedAt(FAKE_TIME + 1)))
    await workspace.archive.archive()
    server.json('POST', paths.restore, reply(restoredAt(FAKE_TIME + 2)))
    await workspace.archive.restore()
    // The stream brings the event of the Archive after the Restore reply.
    updated(archivedAt(FAKE_TIME + 1))
    const late = states()
    updated(restoredAt(FAKE_TIME + 2))
    // Another member archives the workspace again at the same clock.
    updated(archivedAt(FAKE_TIME + 3))
    expect({ late, again: states() }).toEqual({
      late: { detail: 'stopped', row: 'stopped' },
      again: { detail: 'archived', row: 'archived' },
    })
    workspace.close()
  })

  test.each([
    {
      later: 'an Archive of another member',
      record: archivedAt(FAKE_TIME + 3),
      shown: 'archived',
    },
    {
      later: 'a Resume at the time of the Restore',
      record: { ...restoredAt(FAKE_TIME + 2), state: 'starting' as const },
      shown: 'starting',
    },
  ])(
    'a late Restore reply keeps $later that came before it',
    async ({ record, shown }) => {
      const { server, held, workspace, updated, states } =
        await stoppedWorkspace()
      await workspace.open()
      server.json('POST', paths.archive, reply(archivedAt(FAKE_TIME + 1)))
      await workspace.archive.archive()
      server.json('POST', paths.restore, reply(restoredAt(FAKE_TIME + 2)))
      held.holdAnswer('POST', paths.restore)
      const restoring = workspace.archive.restore()
      updated(restoredAt(FAKE_TIME + 2))
      updated(record)
      held.release('POST', paths.restore)
      await restoring
      expect(states()).toEqual({ detail: shown, row: shown })
      workspace.close()
    },
  )

  test('the open detail follows a Restore and the newer archived record of the list, and keeps its own other fields', async () => {
    const { org, workspace } = await stoppedWorkspace()
    await workspace.open()
    await workspace.archive.archive()
    const archived = valueOf(workspace.detail.get())?.workspace
    if (!archived) throw new Error('The workspace did not open.')
    const shown = () => valueOf(workspace.detail.get())?.workspace
    // The list learns that the kept cloud computer is deleted, with a name
    // that the stream of the detail did not bring yet.
    const deleted = {
      ...archived,
      name: 'A name of the list',
      restoreUntil: null,
      updatedAt: archived.updatedAt + 1,
    }
    org.putWorkspace(deleted)
    const ended = shown()
    org.putWorkspace({ ...archived, name: 'An older name of the list' })
    const older = shown()
    org.putWorkspace(restoredAt(deleted.updatedAt + 1))
    expect({ ended, older, restored: shown() }).toEqual({
      ended: { ...archived, restoreUntil: null, updatedAt: deleted.updatedAt },
      older: { ...archived, restoreUntil: null, updatedAt: deleted.updatedAt },
      restored: {
        ...archived,
        state: 'stopped',
        archivedAt: null,
        restoreUntil: null,
        updatedAt: deleted.updatedAt + 1,
      },
    })
    workspace.close()
  })

  test('a first read from before the end of Restore keeps the end that the list already gives', async () => {
    const { server, org, workspace } = await stoppedWorkspace()
    const kept = archivedAt(FAKE_TIME + 1)
    server.json('GET', paths.read, { ...reply(kept), eventNumber: 0 })
    // The list learned of the delete of the kept cloud computer first.
    org.putWorkspace({ ...kept, restoreUntil: null, updatedAt: FAKE_TIME + 2 })
    await workspace.open()
    const lifecycle = (record: Workspace | undefined) => ({
      state: record?.state,
      restoreUntil: record?.restoreUntil,
      updatedAt: record?.updatedAt,
    })
    const ended = {
      state: 'archived',
      restoreUntil: null,
      updatedAt: FAKE_TIME + 2,
    }
    expect({
      detail: lifecycle(valueOf(workspace.detail.get())?.workspace),
      row: lifecycle(org.workspace(FAKE_IDS.workspace)),
    }).toEqual({ detail: ended, row: ended })
    workspace.close()
  })
})
