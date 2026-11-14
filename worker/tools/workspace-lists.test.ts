import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import type { AgentListWorkspacesResponse } from '../../src/shared/generated/AgentListWorkspacesResponse'
import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { createHarness, type TestHarness } from '../test-support/harness'
import { toolFixture, TOOL_TEST_ORIGIN, type ToolFixture } from './test-support'

let harness: TestHarness
let fixture: ToolFixture

beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
  fixture = await toolFixture(harness)
  await fixture.db.batch([
    fixture.db.prepare(
      "UPDATE users SET display_name = 'The owner' WHERE id = 'owner'",
    ),
    fixture.db.prepare(
      "UPDATE workspaces SET updated_at = 100, last_activity_at = 700 WHERE id = 'calling-workspace'",
    ),
    fixture.db.prepare(
      "UPDATE workspaces SET updated_at = 200, last_activity_at = 800 WHERE id = 'teammate-workspace'",
    ),
    fixture.db.prepare(
      "UPDATE workspaces SET updated_at = 300, last_activity_at = 900 WHERE id = 'archived-workspace'",
    ),
    fixture.db.prepare(
      "UPDATE workspaces SET name = 'PaRis ÄÖ 100%_done' WHERE id = 'teammate-workspace'",
    ),
    fixture.db.prepare(
      "UPDATE workspaces SET name = '' WHERE id = 'archived-workspace'",
    ),
    fixture.db.prepare(
      "INSERT INTO repositories (id, org_id, github_repository_id, full_name, default_branch) VALUES ('other-repo', 'org-a', 8, 'example/other', 'dev')",
    ),
    fixture.db.prepare(
      "UPDATE workspaces SET repository_id = 'other-repo' WHERE id = 'archived-workspace'",
    ),
  ])
})
afterAll(async () => {
  await harness.dispose()
})

function list(query: Record<string, string> = {}) {
  const url = new URL(MACHINE_PATHS.workspaces, TOOL_TEST_ORIGIN)
  url.search = new URLSearchParams(query).toString()
  return fixture.request({ headers: { [TOOL_TURN_HEADER]: '' } }, url.href)
}

it('filters the org list independently and together without a turn or a login lookup', async () => {
  const cases = [
    [{ ownerId: 'owner' }, ['calling-workspace', 'archived-workspace']],
    [{ ownerId: '@owner-login' }, []],
    [{ state: 'archived' }, ['archived-workspace']],
    [{ repositoryId: 'other-repo' }, ['archived-workspace']],
    [{ query: 'PARIS' }, ['teammate-workspace']],
    [{ query: ' PARIS ' }, ['teammate-workspace']],
    [{ query: 'PARIS  ÄÖ' }, []],
    [{ query: '%_' }, ['teammate-workspace']],
    [{ query: 'äö' }, ['teammate-workspace']],
    [
      { query: '  ' },
      ['calling-workspace', 'teammate-workspace', 'archived-workspace'],
    ],
    [{ updatedSince: '200' }, ['teammate-workspace', 'archived-workspace']],
    [
      { updatedSince: '-1' },
      ['calling-workspace', 'teammate-workspace', 'archived-workspace'],
    ],
    [{ updatedSince: '+200' }, ['teammate-workspace', 'archived-workspace']],
    [{ archived: 'true' }, ['archived-workspace']],
    [{ archived: 'false' }, ['calling-workspace', 'teammate-workspace']],
    [
      {
        ownerId: 'owner',
        archived: 'true',
        repositoryId: 'other-repo',
        updatedSince: '300',
      },
      ['archived-workspace'],
    ],
    [{ ownerId: 'owner', query: 'paris' }, []],
  ] as const
  for (const [query, ids] of cases) {
    const response = await list(query)
    expect(response.status, JSON.stringify(query)).toBe(200)
    const result: AgentListWorkspacesResponse = await response.json()
    expect(
      result.workspaces.map(({ id }) => id),
      JSON.stringify(query),
    ).toEqual(ids)
  }
  const result: AgentListWorkspacesResponse = await (await list()).json()
  expect(result.workspaces[0]?.owner).toEqual({
    id: 'owner',
    githubLogin: 'owner-login',
    displayName: 'The owner',
  })
  expect(result.workspaces[1]?.owner).toEqual({
    id: 'teammate',
    githubLogin: 'teammate-login',
    displayName: null,
  })
  expect(fixture.services.callingTurn).not.toHaveBeenCalled()
})

it('pages in creation order with exact more flags and preserves unlimited and offset-only lists', async () => {
  const cases = [
    [
      {},
      ['calling-workspace', 'teammate-workspace', 'archived-workspace'],
      undefined,
    ],
    [{ limit: '1' }, ['calling-workspace'], true],
    [{ limit: '1', offset: '2' }, ['archived-workspace'], false],
    [
      { limit: '100' },
      ['calling-workspace', 'teammate-workspace', 'archived-workspace'],
      false,
    ],
    [{ limit: '2', offset: '3' }, [], false],
    [{ offset: '1' }, ['teammate-workspace', 'archived-workspace'], undefined],
    [
      { ownerId: 'owner', limit: '1', offset: '1' },
      ['archived-workspace'],
      false,
    ],
  ] as const
  for (const [query, ids, hasMore] of cases) {
    const response = await list(query)
    expect(response.status).toBe(200)
    const result: AgentListWorkspacesResponse = await response.json()
    expect(
      result.workspaces.map(({ id }) => id),
      JSON.stringify(query),
    ).toEqual(ids)
    expect(result.hasMore, JSON.stringify(query)).toBe(hasMore)
  }
})

it('refuses malformed list filters and paging with invalid_input', async () => {
  const cases: Record<string, string>[] = [
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: '' },
    { offset: '-1' },
    { offset: 'word' },
    { offset: '1.1' },
    { state: 'unknown' },
    { archived: 'maybe' },
    { updatedSince: 'yesterday' },
  ]
  for (const query of cases) {
    const response = await list(query)
    expect(response.status, JSON.stringify(query)).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_input' },
    })
  }
})
