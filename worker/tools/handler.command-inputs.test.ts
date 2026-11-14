import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { routes } from '../../src/app/router'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { sessionLink } from '../../src/shared/session-link'
import {
  createHarness,
  TEST_ORIGIN,
  type TestHarness,
} from '../test-support/harness'
import { publishToolImage, TOOL_MODELS } from './list-test-support'
import { toolFixture, TOOL_TEST_ORIGIN, type ToolFixture } from './test-support'

let harness: TestHarness
let fixture: ToolFixture

beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
  fixture = await toolFixture(harness)
})
afterAll(async () => {
  await harness.dispose()
})

it('creates and lists workspaces and resources through workspace authentication', async () => {
  await publishToolImage(fixture.db)
  fixture.services.models.mockResolvedValue(TOOL_MODELS)
  await fixture.db
    .prepare("UPDATE workspaces SET name = '' WHERE id = 'teammate-workspace'")
    .run()
  const created = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: '  Build this.\nKeep spacing.  ',
    model: { agent: 'claude', model: 'chosen-model' },
    effort: 'max',
    sectionId: 'chosen-a',
    name: 'CLI workspace',
  })
  const listed = await fixture.request()
  const lists: Response[] = []
  for (const path of [
    MACHINE_PATHS.repositories,
    MACHINE_PATHS.sections,
    MACHINE_PATHS.models,
  ]) {
    lists.push(await fixture.request({}, `${TOOL_TEST_ORIGIN}${path}`))
  }

  expect([
    created.status,
    listed.status,
    ...lists.map(({ status }) => status),
  ]).toEqual([201, 200, 200, 200, 200])
  const replies: unknown[] = await Promise.all(
    [created, listed, ...lists].map((response) => response.json()),
  )
  expect(replies[0]).toMatchObject({
    workspace: {
      orgId: 'org-a',
      sectionId: 'chosen-a',
      choice: { agent: 'claude', model: 'chosen-model', effort: 'max' },
    },
    sessionId: 'created-session',
  })
  expect(replies[1]).toEqual({
    workspaces: [
      {
        owner: { id: 'owner', githubLogin: 'owner-login', displayName: null },
        id: 'calling-workspace',
        number: 1,
        link: `${TEST_ORIGIN}${routes.workspace('org-a', 'calling-workspace')}`,
        name: 'Lisbon',
        branch: 'owner-login/lisbon-ab12',
        state: 'working',
      },
      {
        owner: {
          id: 'teammate',
          githubLogin: 'teammate-login',
          displayName: null,
        },
        id: 'teammate-workspace',
        number: 2,
        link: `${TEST_ORIGIN}${routes.workspace('org-a', 'teammate-workspace')}`,
        name: null,
        branch: 'teammate-login/paris-cd34',
        state: 'ready',
      },
      {
        owner: { id: 'owner', githubLogin: 'owner-login', displayName: null },
        id: 'archived-workspace',
        number: 3,
        link: `${TEST_ORIGIN}${routes.workspace('org-a', 'archived-workspace')}`,
        name: 'Rome',
        branch: 'owner-login/rome-ef56',
        state: 'archived',
      },
    ],
  })
  expect(replies.slice(2)).toEqual([
    {
      repositories: [
        {
          id: 'repo-a',
          fullName: 'example/alpha',
          defaultBranch: 'main',
          current: true,
        },
      ],
    },
    {
      sections: [
        { id: 'general-a', name: 'General', default: true },
        { id: 'chosen-a', name: 'Chosen', default: false },
      ],
    },
    {
      models: TOOL_MODELS,
      defaultChoice: {
        agent: 'codex',
        model: 'owner-default-model',
        effort: 'high',
        fast: false,
      },
    },
  ])
  expect(fixture.services.createWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      firstMessage: `  Build this.\nKeep spacing.  \n\n---\nSent by: ${sessionLink(harness.env.APP_ORIGIN, 'org-a', 'calling-workspace', 'calling-session')}`,
      name: 'CLI workspace',
      sender: expect.objectContaining({ id: 'teammate' }),
    }),
  )
})

it('keeps the calling sender and supplied model choice in workspace creation', async () => {
  await publishToolImage(fixture.db)
  await fixture.db
    .prepare("UPDATE workspaces SET name = '' WHERE id = 'teammate-workspace'")
    .run()
  const created = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Delegate this task.',
    model: { agent: 'claude', model: 'mcp-model' },
    effort: 'max',
    sectionId: 'chosen-a',
    name: 'MCP workspace',
  })
  expect(created.status).toBe(201)
  expect(await created.json()).toMatchObject({
    workspace: {
      orgId: 'org-a',
      sectionId: 'chosen-a',
      choice: { agent: 'claude', model: 'mcp-model', effort: 'max' },
    },
    sessionId: 'created-session',
  })
  const listed = await fixture.request()
  expect(listed.status).toBe(200)
  expect(await listed.json()).toMatchObject({
    workspaces: [
      { id: 'calling-workspace' },
      { id: 'teammate-workspace', name: null },
      { id: 'archived-workspace' },
    ],
  })
  expect(fixture.services.createWorkspace).toHaveBeenCalledTimes(1)
  expect(fixture.services.createWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      firstMessage: `Delegate this task.\n\n---\nSent by: ${sessionLink(harness.env.APP_ORIGIN, 'org-a', 'calling-workspace', 'calling-session')}`,
      name: 'MCP workspace',
      sender: expect.objectContaining({ id: 'teammate' }),
    }),
  )
})
