import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { HttpError } from '../http'
import { createHarness, type TestHarness } from '../test-support/harness'
import { publishToolImage, TOOL_MODELS } from './list-test-support'
import {
  OWNER_CHOICE,
  toolFixture,
  TOOL_TEST_ORIGIN,
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
})
afterAll(async () => {
  await harness.dispose()
})

const list = (path: string) =>
  fixture.request(
    { headers: { [TOOL_TURN_HEADER]: '' } },
    `${TOOL_TEST_ORIGIN}${path}?orgId=org-b`,
  )

it('lists only the caller org published image repositories in name order with the current repository', async () => {
  await publishToolImage(fixture.db, 'org-a', 'old-image', [
    {
      id: 'old-repo',
      orgId: 'org-a',
      fullName: 'old/repo',
      defaultBranch: 'old',
    },
  ])
  await publishToolImage(fixture.db, 'org-b', 'outside-image')
  await publishToolImage(fixture.db, 'org-a', 'current-image', [
    {
      id: 'z',
      orgId: 'org-a',
      fullName: 'example/Zebra',
      defaultBranch: 'dev',
    },
    {
      id: 'tie-z',
      orgId: 'org-a',
      fullName: 'example/alpha',
      defaultBranch: 'z',
    },
    {
      id: 'repo-a',
      orgId: 'org-a',
      fullName: 'example/alpha',
      defaultBranch: 'main',
    },
    {
      id: 'upper',
      orgId: 'org-a',
      fullName: 'example/Alpha',
      defaultBranch: 'release',
    },
    {
      id: 'repo-b',
      orgId: 'org-b',
      fullName: 'outside/repo',
      defaultBranch: 'main',
    },
  ])
  await fixture.db
    .prepare(
      `INSERT INTO repositories (id, org_id, github_repository_id, full_name, default_branch, selected)
     VALUES ('selected-only', 'org-a', 3, 'example/selected', 'main', 1)`,
    )
    .run()

  const response = await list(MACHINE_PATHS.repositories)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    repositories: [
      {
        id: 'upper',
        fullName: 'example/Alpha',
        defaultBranch: 'release',
        current: false,
      },
      {
        id: 'repo-a',
        fullName: 'example/alpha',
        defaultBranch: 'main',
        current: true,
      },
      {
        id: 'tie-z',
        fullName: 'example/alpha',
        defaultBranch: 'z',
        current: false,
      },
      {
        id: 'z',
        fullName: 'example/Zebra',
        defaultBranch: 'dev',
        current: false,
      },
    ],
  })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(fixture.services.callingTurn).not.toHaveBeenCalled()
})

it('reports image_required when no good image supplies repositories', async () => {
  const response = await list(MACHINE_PATHS.repositories)
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    error: { code: 'image_required' },
  })
})

it('lists only the caller org sections in sidebar order with the default section', async () => {
  await fixture.db
    .prepare(
      `INSERT INTO sections (id, org_id, name, position, is_default, created_at)
     VALUES ('a-section', 'org-a', 'Earlier at same position', 1, 0, 0)`,
    )
    .run()
  const response = await list(MACHINE_PATHS.sections)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    sections: [
      { id: 'general-a', name: 'General', default: true },
      { id: 'a-section', name: 'Earlier at same position', default: false },
      { id: 'chosen-a', name: 'Chosen', default: false },
    ],
  })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(fixture.services.callingTurn).not.toHaveBeenCalled()
})

it('lists configured models in order with owner, app, or unavailable defaults', async () => {
  fixture.services.models.mockResolvedValue(TOOL_MODELS)
  let response = await list(MACHINE_PATHS.models)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    models: TOOL_MODELS,
    defaultChoice: OWNER_CHOICE,
  })
  expect(fixture.services.ownerDefaultChoice).not.toHaveBeenCalled()

  await fixture.db
    .prepare("DELETE FROM user_preferences WHERE user_id = 'owner'")
    .run()
  const appChoice = {
    agent: 'claude',
    model: 'app-model',
    effort: 'max',
    fast: false,
  } as const
  fixture.services.ownerDefaultChoice.mockResolvedValue(appChoice)
  response = await list(MACHINE_PATHS.models)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    models: TOOL_MODELS,
    defaultChoice: appChoice,
  })
  expect(fixture.services.ownerDefaultChoice).toHaveBeenCalledWith('owner')

  fixture.services.ownerDefaultChoice.mockResolvedValue(null)
  response = await list(MACHINE_PATHS.models)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    models: TOOL_MODELS,
    defaultChoice: null,
  })
  fixture.services.ownerDefaultChoice.mockRejectedValue(
    new HttpError(
      503,
      'default_model_unavailable',
      'The default model is not available.',
    ),
  )
  response = await list(MACHINE_PATHS.models)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    models: TOOL_MODELS,
    defaultChoice: null,
  })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(fixture.services.callingTurn).not.toHaveBeenCalled()
})

it('preserves models_unavailable when the configured model list cannot load', async () => {
  fixture.services.models.mockRejectedValue(
    new HttpError(503, 'models_unavailable', 'The models are not available.'),
  )
  const response = await list(MACHINE_PATHS.models)
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    error: {
      code: 'models_unavailable',
      message: 'The models are not available.',
    },
  })
})
