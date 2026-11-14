import { afterAll, beforeAll, expect, it } from 'vitest'

import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { createHarness, type TestHarness } from '../test-support/harness'
import { publishToolImage } from './list-test-support'
import { TOOL_TEST_ORIGIN, toolFixture } from './test-support'

let harness: TestHarness
beforeAll(async () => {
  harness = await createHarness()
})
afterAll(async () => {
  await harness.dispose()
})

it('requires explicit fast on tool creates and lists each model capability with a standard default', async () => {
  const fixture = await toolFixture(harness)
  await publishToolImage(fixture.db)
  await fixture.db.prepare('UPDATE user_preferences SET default_fast = 1').run()
  fixture.services.models.mockResolvedValue([
    {
      agent: 'codex',
      model: 'owner-default-model',
      label: 'Owner model',
      efforts: ['high'],
      fast: true,
    },
    {
      agent: 'codex',
      model: 'standard-model',
      label: 'Standard',
      efforts: ['high'],
    },
  ])
  const standard = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Standard',
  })
  expect(standard.status).toBe(201)
  expect(fixture.services.createWorkspace).toHaveBeenLastCalledWith(
    expect.objectContaining({
      choice: {
        agent: 'codex',
        model: 'owner-default-model',
        effort: 'high',
        fast: false,
      },
    }),
  )
  const fast = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Fast',
    fast: true,
  })
  expect(fast.status).toBe(201)
  expect(fixture.services.createWorkspace).toHaveBeenLastCalledWith(
    expect.objectContaining({
      choice: {
        agent: 'codex',
        model: 'owner-default-model',
        effort: 'high',
        fast: true,
      },
    }),
  )
  const unmarked = await fixture.create({
    repositoryId: 'repo-a',
    firstMessage: 'Unmarked',
    model: { agent: 'codex', model: 'standard-model' },
    effort: 'high',
    fast: true,
  })
  expect(unmarked.status).toBe(201)
  expect(fixture.services.createWorkspace).toHaveBeenLastCalledWith(
    expect.objectContaining({
      choice: {
        agent: 'codex',
        model: 'standard-model',
        effort: 'high',
        fast: false,
      },
    }),
  )
  const response = await fixture.request(
    {},
    `${TOOL_TEST_ORIGIN}${MACHINE_PATHS.models}`,
  )
  expect(await response.json()).toMatchObject({
    models: [{ fast: true }, { fast: false }],
    defaultChoice: { fast: false },
  })
})
