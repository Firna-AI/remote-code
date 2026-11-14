import type { Workspace } from '../shared/generated/Workspace'
import { expect, test } from 'vitest'
import { workspacePath, workspacesPath } from '../shared/workspaces'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import { OrgModel } from './org-model'
import { HeldRequests, testServices } from './test-kit'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const path = workspacePath(orgId, workspaceId)

test('a row rename confirms its name and keeps newer fields from a list read', async () => {
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
  const server = new FakeApiServer()
  const held = new HeldRequests(server)
  const org = new OrgModel(testServices(server, { fetch: held.fetch }), orgId)
  await org.reload('list')
  server.json('PATCH', path, {
    ...fixtures.detail,
    workspace: { ...before, name: 'Saved guest carts' },
  })
  held.holdAnswer('PATCH', path)
  const renaming = org.workspaceActions.rename(workspaceId, 'Saved guest carts')
  const newer: Workspace = {
    ...before,
    name: 'A name from another tab',
    state: 'working',
    sectionId: 'general',
    owner: { ...before.owner, id: 'new-owner' },
    updatedAt: FAKE_TIME + 1_000,
  }
  server.json('GET', workspacesPath(orgId), {
    workspaces: fixtures.workspaces.workspaces.map((workspace) =>
      workspace.id === workspaceId ? newer : workspace,
    ),
  })
  await org.reload('list')
  held.release('PATCH', path)
  await renaming
  expect(org.workspace(workspaceId)).toEqual({
    ...newer,
    name: 'Saved guest carts',
  })
  const write = server.requests.find((request) => request.method === 'PATCH')
  expect(await write?.json()).toEqual({ name: 'Saved guest carts' })
})
