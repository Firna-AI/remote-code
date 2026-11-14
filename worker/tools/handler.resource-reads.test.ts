import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
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

it('reads repositories, sections, and models without an active turn', async () => {
  await publishToolImage(fixture.db)
  fixture.services.models.mockResolvedValue(TOOL_MODELS)
  const replies: unknown[] = []
  for (const path of [
    MACHINE_PATHS.repositories,
    MACHINE_PATHS.sections,
    MACHINE_PATHS.models,
  ]) {
    const response = await fixture.request(
      { headers: { [TOOL_TURN_HEADER]: '' } },
      `${TOOL_TEST_ORIGIN}${path}`,
    )
    expect(response.status, path).toBe(200)
    replies.push(await response.json())
  }
  expect(replies).toEqual([
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
    { models: TOOL_MODELS, defaultChoice: OWNER_CHOICE },
  ])
  expect(fixture.services.callingTurn).not.toHaveBeenCalled()
})
