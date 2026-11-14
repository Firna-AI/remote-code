import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { sessionLink } from '../../src/shared/session-link'
import { configuredDefaultChoice } from '../app-api/models'
import { HttpError } from '../http'
import { createHarness, type TestHarness } from '../test-support/harness'
import { publishToolImage } from './list-test-support'
import {
  OWNER_CHOICE,
  toolFixture,
  TOOL_TEST_TURN,
  type ToolFixture,
} from './test-support'

let harness: TestHarness
let fixture: ToolFixture

beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
  fixture = await toolFixture(harness)
  await publishToolImage(fixture.db)
})
afterAll(async () => {
  await harness.dispose()
})

it('inherits the org, owner, and owner defaults while the calling sender starts the first message', async () => {
  const response = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: '  Keep this text.\nThen continue.  ',
    name: 42,
    orgId: 'org-b',
    ownerUserId: 'outsider',
  })

  expect(response.status).toBe(201)
  expect(fixture.services.callingTurn).toHaveBeenCalledWith(
    'calling-workspace',
    TOOL_TEST_TURN,
  )
  expect(fixture.services.createWorkspace).toHaveBeenCalledExactlyOnceWith({
    firstMessageId: expect.any(String),
    orgId: 'org-a',
    owner: {
      id: 'owner',
      githubLogin: 'owner-login',
      displayName: null,
      avatarUrl: null,
    },
    repositoryId: 'repo-a',
    sectionId: 'general-a',
    choice: OWNER_CHOICE,
    firstMessage: `  Keep this text.\nThen continue.  \n\n---\nSent by: ${sessionLink(harness.env.APP_ORIGIN, 'org-a', 'calling-workspace', 'calling-session')}`,
    sender: {
      id: 'teammate',
      githubLogin: 'teammate-login',
      displayName: null,
      avatarUrl: null,
    },
    createdByWorkspaceId: 'calling-workspace',
  })
  expect(await response.json()).toMatchObject({
    workspace: { orgId: 'org-a', owner: { id: 'owner' }, choice: OWNER_CHOICE },
    sessionId: 'created-session',
  })
})

it('omits a blank name before workspace creation', async () => {
  const response = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Task',
    name: ' \n\t\n ',
  })

  expect(response.status).toBe(201)
  expect(fixture.services.createWorkspace).toHaveBeenCalledOnce()
  expect(
    fixture.services.createWorkspace.mock.calls[0]?.[0],
  ).not.toHaveProperty('name')
})

it('uses the chosen model, effort, and org section without looking up unresolved defaults', async () => {
  await fixture.db.prepare('DELETE FROM user_preferences').run()
  fixture.services.ownerDefaultChoice.mockRejectedValue(
    new Error('Defaults must not be read'),
  )
  const response = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Build the feature.',
    model: { agent: 'claude', model: 'chosen-model' },
    effort: 'max',
    sectionId: 'chosen-a',
  })

  expect(response.status).toBe(201)
  expect(fixture.services.createWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      sectionId: 'chosen-a',
      choice: {
        agent: 'claude',
        model: 'chosen-model',
        effort: 'max',
        fast: false,
      },
    }),
  )
  expect(fixture.services.ownerDefaultChoice).not.toHaveBeenCalled()
})

it('blocks repositories and sections outside the calling org', async () => {
  for (const [input, code] of [
    [{ repositoryId: 'repo-b', firstMessage: 'Task' }, 'repository_not_found'],
    [
      { repositoryId: 'repo-a', firstMessage: 'Task', sectionId: 'general-b' },
      'section_not_found',
    ],
  ] as const) {
    const response = await fixture.create(input)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code } })
  }
  expect(fixture.services.createWorkspace).not.toHaveBeenCalled()
})

it('refuses a waiting repository with build guidance and an unchosen repository as unavailable', async () => {
  await fixture.db
    .prepare(
      `INSERT INTO repositories
    (id, org_id, github_repository_id, full_name, default_branch, selected)
    VALUES ('waiting', 'org-a', 3, 'example/waiting', 'main', 1)`,
    )
    .run()
  const waiting = await fixture.create({
    repositoryId: 'waiting',
    firstMessage: 'Task',
  })
  expect(waiting.status).toBe(404)
  expect(await waiting.json()).toEqual({
    error: {
      code: 'repository_not_found',
      message: 'The repository is ready after the next build.',
    },
  })
  await fixture.db
    .prepare("UPDATE repositories SET selected = 0 WHERE id = 'waiting'")
    .run()
  const removed = await fixture.create({
    repositoryId: 'waiting',
    firstMessage: 'Task',
  })
  expect(removed.status).toBe(404)
  expect(await removed.json()).toEqual({
    error: {
      code: 'repository_not_found',
      message: 'The repository is not available.',
    },
  })
  expect(fixture.services.createWorkspace).not.toHaveBeenCalled()
})

it('rejects absent or stale turn context, mismatched workspaces, and senders outside the org', async () => {
  const missing = await fixture.create(
    { repositoryId: 'repo-a', firstMessage: 'Task' },
    { [TOOL_TURN_HEADER]: '' },
  )
  expect(missing.status).toBe(403)
  for (const turn of [
    null,
    {
      workspaceId: 'outside-workspace',
      sessionId: 'calling-session',
      turnId: TOOL_TEST_TURN,
      senderUserId: 'teammate',
    },
    {
      workspaceId: 'calling-workspace',
      turnId: 'old-turn',
      sessionId: 'calling-session',
      senderUserId: 'teammate',
    },
    {
      workspaceId: 'calling-workspace',
      turnId: TOOL_TEST_TURN,
      senderUserId: 'outsider',
      sessionId: 'calling-session',
    },
  ]) {
    fixture.services.callingTurn.mockResolvedValue(turn)
    const response = await fixture.create({
      repositoryId: 'repo-a',
      firstMessage: 'Task',
    })
    expect(response.status, JSON.stringify(turn)).toBe(403)
  }
  expect(fixture.services.createWorkspace).not.toHaveBeenCalled()
})

it('uses the account default policy when needed and exposes unresolved defaults without inventing a model', async () => {
  await fixture.db.prepare('DELETE FROM user_preferences').run()
  const unavailable = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Task',
  })
  expect(unavailable.status).toBe(503)
  expect(await unavailable.json()).toMatchObject({
    error: { code: 'owner_defaults_unavailable' },
  })
  expect(fixture.services.createWorkspace).not.toHaveBeenCalled()

  fixture.services.ownerDefaultChoice.mockResolvedValue({
    agent: 'claude',
    model: 'account-default',
    effort: 'medium',
    fast: false,
  })
  const fromPolicy = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Task',
    effort: 'low',
  })
  expect(fromPolicy.status).toBe(201)
  expect(fixture.services.ownerDefaultChoice).toHaveBeenCalledWith('owner')
  expect(fixture.services.createWorkspace).toHaveBeenLastCalledWith(
    expect.objectContaining({
      choice: {
        agent: 'claude',
        model: 'account-default',
        effort: 'low',
        fast: false,
      },
    }),
  )
})

it('reports a lifecycle start failure instead of a successful create', async () => {
  fixture.services.createWorkspace.mockRejectedValue(
    new HttpError(
      503,
      'sandbox_start_failed',
      'The cloud computer could not start. Try again.',
    ),
  )
  const response = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Task',
  })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    error: {
      code: 'sandbox_start_failed',
      message: 'The cloud computer could not start. Try again.',
    },
  })
})

it('uses the configured model for an owner who saved only the workspace view', async () => {
  await fixture.db
    .prepare(
      `UPDATE user_preferences SET default_agent = NULL, default_model = NULL,
       default_effort = NULL, new_workspace_view = 'dialog' WHERE user_id = 'owner'`,
    )
    .run()
  harness.env.CONDUCTIVE_DEFAULT_CHOICE = JSON.stringify({
    agent: 'claude',
    model: 'configured-model',
    effort: 'medium',
    fast: false,
  })
  fixture.services.ownerDefaultChoice.mockImplementation(async () =>
    configuredDefaultChoice(harness.env),
  )

  const response = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Build the feature.',
  })
  expect(response.status).toBe(201)
  expect(fixture.services.createWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      choice: {
        agent: 'claude',
        model: 'configured-model',
        effort: 'medium',
        fast: false,
      },
    }),
  )
})
