import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import { afterEach, expect, test, vi } from 'vitest'
import {
  WORKSPACE_RESTORE_MS,
  workspacePath,
  workspacePaths,
} from '../../shared/workspaces'
import { FakeApiServer } from '../../test-support/fake-api'
import { FakeWorkspaceEvents } from '../../test-support/fake-events'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { createApiClient } from '../api/client'
import {
  readOrderedWorkspaceResponse,
  readWorkspaceResponse,
} from '../api/read-workspaces'
import { createBackend, guardScope } from './backend'
import { readDevOptions } from './options'
import { routeFetch } from './router'
import { seedState } from './seed'
import { workspaceRoutes } from './workspace-routes'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const path = workspacePath(orgId, workspaceId)
const owner = {
  id: 'cal',
  githubLogin: 'calummoore',
  displayName: 'Cal',
  avatarUrl: null,
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

function setup(state: WorkspaceState, now: () => number = () => FAKE_TIME) {
  const server = new FakeApiServer()
  const backend = createBackend(
    seedState(readDevOptions(`?workspace=${state}`)),
    new FakeWorkspaceEvents([]),
    now,
    () => 'unused',
  )
  for (let number = 1; number <= 7; number += 1) {
    backend.emit(workspaceId, {
      type: 'workspace.title',
      name: 'Recorded workspace name',
    })
  }
  const api = createApiClient(
    routeFetch(
      workspaceRoutes(backend),
      (requestPath) => guardScope(backend.state, requestPath),
      server.fetch,
    ),
  )
  return { api, backend }
}

test('development detail reads include the current event number for the ordered reader', async () => {
  const { api, backend } = setup('ready')
  const { detail } = workspaceFixtures()
  const workspace = { ...detail.workspace, owner }
  await expect(api.get(path, readOrderedWorkspaceResponse)).resolves.toEqual({
    ...detail,
    workspace,
    eventNumber: 7,
  })
  backend.emit(workspaceId, {
    type: 'workspace.title',
    name: 'Recorded workspace name',
  })
  await expect(api.get(path, readOrderedWorkspaceResponse)).resolves.toEqual({
    ...detail,
    workspace,
    eventNumber: 8,
  })
})

test('development Resume includes its starting event number for the ordered reader', async () => {
  vi.useFakeTimers()
  const { api } = setup('stopped')
  await expect(
    api.send(
      'POST',
      workspacePaths.resume(orgId, workspaceId),
      {},
      readOrderedWorkspaceResponse,
    ),
  ).resolves.toEqual({
    eventNumber: 8,
    workspace: {
      ...workspaceFixtures('stopped').detail.workspace,
      owner,
      state: 'starting',
      updatedAt: FAKE_TIME,
    },
    start: {
      kind: 'resume',
      startedAt: FAKE_TIME,
      steps: [
        {
          id: 'restore',
          label: 'Resuming with your files as you left them',
          state: 'running',
          startedAt: FAKE_TIME,
          completedAt: null,
        },
      ],
    },
    error: null,
  })
})

test('development Rename trims the name, records its time, keeps the branch, and refuses an archived workspace', async () => {
  const { api } = setup('ready')
  const before = await api.get(path, readWorkspaceResponse)
  const renamed = await api.send(
    'PATCH',
    path,
    { name: '  Saved guest carts  ' },
    readWorkspaceResponse,
  )
  expect(renamed.workspace).toEqual({
    ...before.workspace,
    name: 'Saved guest carts',
    updatedAt: FAKE_TIME,
  })
  await api.send(
    'POST',
    workspacePaths.archive(orgId, workspaceId),
    {},
    readWorkspaceResponse,
  )
  await expect(
    api.send('PATCH', path, { name: 'Archived rename' }, readWorkspaceResponse),
  ).rejects.toMatchObject({
    status: 409,
    code: 'workspace_archived',
    message: 'The archived chat is read-only.',
  })
  expect((await api.get(path, readWorkspaceResponse)).workspace.name).toBe(
    'Saved guest carts',
  )
})

test('development Archive and Restore raise the time of the record at one clock, keep Restore for 14 days, and refuse a Restore after them', async () => {
  let now = FAKE_TIME
  const { api } = setup('stopped', () => now)
  const write = async (action: 'archive' | 'restore') => {
    const { workspace } = await api.send(
      'POST',
      workspacePaths[action](orgId, workspaceId),
      {},
      readWorkspaceResponse,
    )
    const { state, archivedAt, restoreUntil, updatedAt }: Workspace = workspace
    return { state, archivedAt, restoreUntil, updatedAt }
  }
  const archived = {
    state: 'archived',
    archivedAt: FAKE_TIME,
    restoreUntil: FAKE_TIME + WORKSPACE_RESTORE_MS,
  }
  const restored = { state: 'stopped', archivedAt: null, restoreUntil: null }
  const changes = [
    await write('archive'),
    await write('restore'),
    await write('restore'),
    await write('archive'),
  ]
  now = FAKE_TIME + WORKSPACE_RESTORE_MS
  expect({
    changes,
    late: await write('restore').catch((error: unknown) => error),
  }).toEqual({
    changes: [
      { ...archived, updatedAt: FAKE_TIME },
      { ...restored, updatedAt: FAKE_TIME + 1 },
      { ...restored, updatedAt: FAKE_TIME + 1 },
      { ...archived, updatedAt: FAKE_TIME + 2 },
    ],
    late: expect.objectContaining({
      status: 409,
      code: 'workspace_restore_unavailable',
      message: 'The time to restore this workspace has ended.',
    }),
  })
})
