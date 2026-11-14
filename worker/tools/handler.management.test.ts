import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { createHarness, type TestHarness } from '../test-support/harness'
import { TOOL_ROUTE_CASES } from './management-cases.test-support'
import { toolRouteFixture } from './management-test-support'
import { TOOL_TEST_ORIGIN } from './test-support'

let harness: TestHarness
beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
})
afterAll(async () => {
  await harness.dispose()
})

it('routes management requests and list/create options through the handler', async () => {
  const fixture = await toolRouteFixture(harness)
  for (const item of TOOL_ROUTE_CASES) {
    const url = new URL(item.path, TOOL_TEST_ORIGIN)
    for (const [key, value] of Object.entries(item.query ?? {}))
      url.searchParams.set(key, value)
    const response = await fixture.request(
      item.body === undefined
        ? { headers: { [TOOL_TURN_HEADER]: '' } }
        : { method: 'POST', body: JSON.stringify(item.body) },
      url.href,
    )
    expect(response.status, item.name).toBe(
      ['create_workspace', 'create_section', 'open_preview'].includes(item.name)
        ? 201
        : 200,
    )
    expect(await response.json(), item.name).toMatchObject(item.reply)
  }
})
