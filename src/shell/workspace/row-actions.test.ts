import type { Workspace } from '../../shared/generated/Workspace'
import { expect, test } from 'vitest'
import { AppModel } from '../../app/app-model'
import { valueOf } from '../../app/store'
import {
  flushMicrotasks,
  HeldRequests,
  RecordingEvents,
  requestLines,
  testServices,
} from '../../app/test-kit'
import { sectionsPath } from '../../shared/sections'
import {
  WORKSPACE_RESTORE_MS,
  workspacePath,
  workspacePaths,
  workspacesPath,
} from '../../shared/workspaces'
import { FakeApiServer } from '../../test-support/fake-api'
import {
  coreFixtures,
  FAKE_IDS,
  FAKE_TIME,
} from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { ShownWorkspaces } from './shown-workspaces'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const identity = { orgId, workspaceId }
const path = workspacePath(orgId, workspaceId)
const fixtures = workspaceFixtures()
const before: Workspace = {
  ...fixtures.detail.workspace,
  owner: {
    id: 'cal',
    githubLogin: 'calummoore',
    displayName: 'Cal',
    avatarUrl: null,
  },
}
const owner = { ...before.owner, id: 'new-owner' }

async function setup() {
  const server = new FakeApiServer()
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  const app = new AppModel(testServices(server, { fetch: held.fetch, events }))
  await app.start()
  const org = app.org(orgId)
  await org.reload('list')
  const memory = new ShownWorkspaces(
    app,
    coreFixtures().account.user.id,
    () => true,
  )
  return { server, held, events, org, memory }
}

function serveList(server: FakeApiServer, changed: Workspace) {
  server.json('GET', workspacesPath(orgId), {
    workspaces: fixtures.workspaces.workspaces.map((workspace) =>
      workspace.id === changed.id ? changed : workspace,
    ),
  })
}

test('a kept row rename keeps its view and newer list fields through metadata and Resume', async () => {
  const { server, held, org, memory } = await setup()
  const view = memory.view(identity)
  held.holdAnswer('GET', path)
  const opening = view.model.open()
  server.json('PATCH', path, {
    ...fixtures.detail,
    workspace: { ...before, name: 'The first saved name' },
  })
  await memory.rename(identity, 'The first saved name')
  held.release('GET', path)
  await opening
  expect(valueOf(view.model.detail.get())?.workspace.name).toBe(
    'The first saved name',
  )
  view.chat.show()
  await flushMicrotasks()
  view.chat.updateView((saved) => ({
    ...saved,
    fileList: 'checks',
    tool: 'preview',
  }))
  await flushMicrotasks()
  const saved = view.chat.getSnapshot().view
  expect(saved).toMatchObject({ fileList: 'checks', tool: 'preview' })
  const resumePath = workspacePaths.resume(orgId, workspaceId)
  held.holdAnswer('POST', resumePath)
  const resuming = view.model.resume()
  const newer: Workspace = {
    ...before,
    sectionId: 'general',
    state: 'working',
    owner,
    updatedAt: FAKE_TIME + 1_000,
  }
  serveList(server, newer)
  await org.reload('list')
  server.json('PATCH', path, {
    ...fixtures.detail,
    workspace: { ...before, name: 'Saved guest carts' },
  })
  await memory.rename(identity, 'Saved guest carts')
  expect(valueOf(view.model.detail.get())?.workspace).toEqual({
    ...before,
    name: 'Saved guest carts',
  })
  expect(org.workspace(workspaceId)).toEqual({
    ...newer,
    name: 'Saved guest carts',
  })
  held.release('POST', resumePath)
  await resuming
  expect(valueOf(view.model.detail.get())?.workspace.name).toBe(
    'Saved guest carts',
  )
  expect(org.workspace(workspaceId)?.name).toBe('Saved guest carts')
  expect(view.chat.getSnapshot().view).toEqual(saved)
  view.model.close()
  view.chat.stop()
})

test('owner replies change only the owner for unopened and kept rows', async () => {
  const { server, events, org, memory } = await setup()
  const newer: Workspace = {
    ...before,
    name: 'A newer name',
    state: 'working',
    sectionId: 'general',
    updatedAt: FAKE_TIME + 1_000,
  }
  serveList(server, newer)
  await org.reload('list')
  const from = server.requests.length
  memory.reassigned({ ...before, owner })
  expect(org.workspace(workspaceId)).toEqual({ ...newer, owner })
  expect(requestLines(server).slice(from)).toEqual([])
  expect(events.opened).toEqual([])
  const view = memory.view(identity)
  await view.model.open()
  events.send({
    type: 'event',
    envelope: {
      workspaceId,
      eventNumber: 1,
      occurredAt: FAKE_TIME,
      event: { type: 'workspace.updated', workspace: newer },
    },
  })
  const listed = {
    ...newer,
    name: 'The latest listed name',
    updatedAt: FAKE_TIME + 2_000,
  }
  serveList(server, listed)
  await org.reload('list')
  memory.reassigned({ ...before, owner })
  expect(valueOf(view.model.detail.get())?.workspace).toEqual({
    ...newer,
    owner,
  })
  expect(org.workspace(workspaceId)).toEqual({ ...listed, owner })
  view.model.close()
  memory.reassigned({ ...before, owner: before.owner })
  expect(org.workspace(workspaceId)).toEqual(listed)
  expect(valueOf(view.model.detail.get())?.workspace).toEqual(newer)
})

test('an unopened stopped row archives with one request and keeps the current workspace and newer fields', async () => {
  const { server, held, events, org, memory } = await setup()
  serveList(server, { ...before, state: 'stopped' })
  await org.reload('list')
  const current = memory.view({ orgId, workspaceId: 'email-dark-mode' })
  await current.model.open()
  const currentDetail = current.model.detail.get()
  const archive = memory.archive(identity)
  const from = server.requests.length
  const archivePath = workspacePaths.archive(orgId, workspaceId)
  // The Worker raises the time of the record at each Archive, so its reply
  // is newer than each change before it.
  const archivedAt = FAKE_TIME + 2_000
  const restoreUntil = archivedAt + WORKSPACE_RESTORE_MS
  server.json('POST', archivePath, {
    workspace: {
      ...before,
      state: 'archived',
      archivedAt,
      restoreUntil,
      updatedAt: archivedAt,
    },
    start: null,
    error: null,
  })
  held.holdAnswer('POST', archivePath)
  const archiving = archive.archive()
  const newer: Workspace = {
    ...before,
    name: 'A newer name',
    sectionId: 'general',
    owner,
    updatedAt: FAKE_TIME + 1_000,
  }
  serveList(server, newer)
  await org.reload('list')
  held.release('POST', archivePath)
  await archiving
  expect(org.workspace(workspaceId)).toEqual({
    ...newer,
    state: 'archived',
    archivedAt,
    restoreUntil,
    updatedAt: archivedAt,
  })
  expect(current.model.detail.get()).toEqual(currentDetail)
  expect(events.opened).toEqual([
    { orgId, workspaceId: 'email-dark-mode', afterEventNumber: 0 },
  ])
  const requests = server.requests.slice(from)
  expect(requestLines(server).slice(from)).toEqual([
    `POST ${archivePath}`,
    `GET ${sectionsPath(orgId)}`,
    `GET ${workspacesPath(orgId)}`,
  ])
  expect(
    await requests.find((request) => request.method === 'POST')?.json(),
  ).toEqual({})
  expect(memory.archive({ orgId, workspaceId: 'email-dark-mode' })).toBe(
    current.model.archive,
  )
  current.model.close()
  expect(memory.archive({ orgId, workspaceId: 'email-dark-mode' })).toBe(
    current.model.archive,
  )
  if (currentDetail.state !== 'ready')
    throw new Error('The current workspace did not open.')
  const acknowledgedAt = FAKE_TIME + 5_000
  server.json('POST', workspacePaths.archive(orgId, 'email-dark-mode'), {
    ...currentDetail.value,
    workspace: {
      ...currentDetail.value.workspace,
      state: 'archived',
      archivedAt: acknowledgedAt,
      updatedAt: acknowledgedAt,
    },
    start: null,
    error: null,
  })
  const keptArchive = memory.archive({ orgId, workspaceId: 'email-dark-mode' })
  await keptArchive.archive()
  const expectedWorkspace = {
    ...currentDetail.value.workspace,
    state: 'archived',
    archivedAt: acknowledgedAt,
    updatedAt: acknowledgedAt,
  }
  expect({
    listed: org.workspace('email-dark-mode'),
    detail: valueOf(current.model.detail.get()),
  }).toEqual({
    listed: expectedWorkspace,
    detail: { workspace: expectedWorkspace, start: null, error: null },
  })
})
