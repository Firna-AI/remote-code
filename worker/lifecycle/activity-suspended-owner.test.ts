import { expect, it } from 'vitest'

import { workspacePaths } from '../../src/shared/workspaces'
import { joinedMember } from '../operator/suspension-test-support'
import { setupBackendTests } from './backend-test-hooks'
import { handleLifecycleRequest } from './browser'
import { createCompletedWorkspace } from './completed-creation-test-support'
import { FIRST_MESSAGE } from './durable-test-support'

const fixtureForTest = setupBackendTests()

it('accepts another member activity without extending a suspended owner sandbox deadline', async () => {
  const fixture = fixtureForTest()
  const member = await joinedMember(fixture)
  await fixture.runtime.env.DB.prepare(
    "UPDATE org_members SET role = 'admin' WHERE org_id = ? AND user_id = ?",
  )
    .bind(fixture.org.id, member.id)
    .run()
  const created = await fixture.run(() =>
    createCompletedWorkspace(fixture.runtime, fixture.org.id, fixture.user, {
      repositoryId: fixture.repositoryId,
      firstMessage: FIRST_MESSAGE,
    }),
  )
  const deadlines = fixture.boat.deadlineIds.length
  await fixture.runtime.env.DB.prepare(
    'UPDATE users SET suspended_at = ? WHERE id = ?',
  )
    .bind(fixture.runtime.dependencies.now(), fixture.user.id)
    .run()
  const response = await handleLifecycleRequest(
    new Request(
      `https://app.conductive.test${workspacePaths.activity(fixture.org.id, created.workspace.id)}`,
      { method: 'POST' },
    ),
    {
      org: fixture.org,
      user: member,
      sessionId: 'member-session',
      body: { source: 'input' },
    },
    { ...fixture.runtime, images: fixture.images },
    {
      acceptFirstMessage: async () => {
        throw new Error('This request does not create a workspace.')
      },
      waitUntil: () => {},
    },
  )
  expect(response?.status).toBe(200)
  expect(await response?.json()).toEqual({})
  expect(fixture.boat.deadlineIds.slice(deadlines)).toEqual([])
  expect(fixture.boat.states.get('bx_1')).toBe('ready')
})
