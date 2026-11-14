import { vi } from 'vitest'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { routes } from '../../src/app/router'
import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { sessionLink } from '../../src/shared/session-link'
import type { AgentModel } from '../../src/shared/generated/AgentModel'
import { requestBodyEntry } from '../http/request-body'
import { hash } from '../security/crypto'
import { TEST_TIME, type TestHarness } from '../test-support/harness'
import { createAgentToolsHandler } from './handler'
import type {
  AgentToolServices,
  CallingTurn,
  ToolWorkspaceCreation,
} from './services'

export const TOOL_TEST_ORIGIN = 'https://machine.conductive.test'
const TOOL_TEST_TOKEN = 'workspace-token-for-tools-tests'
export const TOOL_TEST_TURN = 'turn-from-teammate'
export const OWNER_CHOICE = {
  agent: 'codex',
  model: 'owner-default-model',
  effort: 'high',
  fast: false,
} satisfies AgentChoice

export async function toolFixture(harness: TestHarness) {
  const db = harness.env.DB
  await db.batch([
    ...[
      ['owner', 101, 'owner-login'],
      ['teammate', 102, 'teammate-login'],
      ['outsider', 103, 'outsider-login'],
    ].map(([id, githubId, login]) =>
      db
        .prepare(
          'INSERT INTO users (id, github_id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, githubId, login, TEST_TIME, TEST_TIME),
    ),
    db
      .prepare(
        'INSERT INTO orgs (id, name, creator_user_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      )
      .bind(
        'org-a',
        'Org A',
        'owner',
        TEST_TIME,
        'org-b',
        'Org B',
        'outsider',
        TEST_TIME,
      ),
    db
      .prepare(
        `INSERT INTO org_members (org_id, user_id, role, joined_at)
       VALUES ('org-a', 'owner', 'admin', ?), ('org-a', 'teammate', 'member', ?),
       ('org-b', 'outsider', 'admin', ?)`,
      )
      .bind(TEST_TIME, TEST_TIME, TEST_TIME),
    db
      .prepare(
        `INSERT INTO sections (id, org_id, name, position, is_default, created_at)
       VALUES ('general-a', 'org-a', 'General', 0, 1, ?),
       ('chosen-a', 'org-a', 'Chosen', 1, 0, ?),
       ('general-b', 'org-b', 'General', 0, 1, ?)`,
      )
      .bind(TEST_TIME, TEST_TIME, TEST_TIME),
    db.prepare(
      `INSERT INTO repositories (id, org_id, github_repository_id, full_name, default_branch)
       VALUES ('repo-a', 'org-a', 1, 'example/alpha', 'main'),
       ('repo-b', 'org-b', 2, 'example/beta', 'main')`,
    ),
    ...[
      [
        'calling-workspace',
        'org-a',
        'repo-a',
        'owner',
        'general-a',
        'Lisbon',
        'owner-login/lisbon-ab12',
        'working',
        null,
      ],
      [
        'teammate-workspace',
        'org-a',
        'repo-a',
        'teammate',
        'general-a',
        'Paris',
        'teammate-login/paris-cd34',
        'ready',
        null,
      ],
      [
        'archived-workspace',
        'org-a',
        'repo-a',
        'owner',
        'general-a',
        'Rome',
        'owner-login/rome-ef56',
        'archived',
        TEST_TIME,
      ],
      [
        'outside-workspace',
        'org-b',
        'repo-b',
        'outsider',
        'general-b',
        'Tokyo',
        'outsider-login/tokyo-gh78',
        'ready',
        null,
      ],
    ].map((values, index) =>
      db
        .prepare(
          `INSERT INTO workspaces
         (id, org_id, repository_id, owner_user_id, section_id, name, branch, state, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(...values, TEST_TIME + index, TEST_TIME + index),
    ),
    db
      .prepare(
        `INSERT INTO workspace_tokens (workspace_id, token_hash, ciphertext, created_at)
       VALUES ('calling-workspace', ?, 'encrypted-test-token', ?)`,
      )
      .bind(await hash(TOOL_TEST_TOKEN), TEST_TIME),
    db
      .prepare(
        `INSERT INTO user_preferences (user_id, default_agent, default_model, default_effort, updated_at)
       VALUES ('owner', 'codex', 'owner-default-model', 'high', ?),
       ('teammate', 'claude', 'teammate-default-model', 'max', ?)`,
      )
      .bind(TEST_TIME, TEST_TIME),
  ])
  const callingTurn = vi.fn(async (): Promise<CallingTurn | null> => ({
    workspaceId: 'calling-workspace',
    turnId: TOOL_TEST_TURN,
    senderUserId: 'teammate',
    sessionId: 'calling-session',
  }))
  const ownerDefaultChoice = vi.fn(
    async (): Promise<AgentChoice | null> => null,
  )
  const models = vi.fn(async (): Promise<readonly AgentModel[]> => [])
  const createWorkspace = vi.fn(async (input: ToolWorkspaceCreation) => ({
    workspace: {
      id: 'created-workspace',
      number: 4,
      link: `${harness.env.APP_ORIGIN}${routes.workspace(input.orgId, 'created-workspace')}`,
      orgId: input.orgId,
      repositoryId: input.repositoryId,
      sectionId: input.sectionId,
      owner: input.owner,
      name: 'Berlin',
      branch: `${input.owner.githubLogin}/berlin-ij90`,
      choice: input.choice,
      state: 'starting' as const,
      github: null,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME,
      archivedAt: null,
      restoreUntil: null,
    },
    sessionId: 'created-session',
    sessionLink: sessionLink(
      harness.env.APP_ORIGIN,
      input.orgId,
      'created-workspace',
      'created-session',
    ),
  }))
  const services = {
    writeSection: vi.fn<AgentToolServices['writeSection']>(),
    previewCall: vi.fn<AgentToolServices['previewCall']>(),
    replayWorkspaceCreation: vi
      .fn<AgentToolServices['replayWorkspaceCreation']>()
      .mockResolvedValue(null),
    writeWorkspace: vi.fn<AgentToolServices['writeWorkspace']>(),
    callingTurn,
    ownerDefaultChoice,
    createWorkspace,
    models,
    getSession: vi.fn<AgentToolServices['getSession']>(),
    getMessage: vi.fn<AgentToolServices['getMessage']>(),
    manageSession: vi.fn<AgentToolServices['manageSession']>(),
    listSessions: vi.fn<AgentToolServices['listSessions']>(),
    readSession: vi.fn<AgentToolServices['readSession']>(),
    writeSession: vi.fn<AgentToolServices['writeSession']>(),
  }
  const env = { ...harness.env, MACHINE_ORIGIN: TOOL_TEST_ORIGIN }
  const entry = requestBodyEntry(createAgentToolsHandler(env, services))
  const handler = (request: Request) => entry(request, env)
  const request = (
    init: RequestInit = {},
    url = `${TOOL_TEST_ORIGIN}${MACHINE_PATHS.workspaces}`,
  ) => {
    const headers = new Headers(init.headers)
    if (!headers.has('Authorization'))
      headers.set('Authorization', `Bearer ${TOOL_TEST_TOKEN}`)
    if (!headers.has(TOOL_TURN_HEADER))
      headers.set(TOOL_TURN_HEADER, TOOL_TEST_TURN)
    if (init.body && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json')
    return handler(new Request(url, { ...init, headers }))
  }
  const create = (body: unknown, headers?: HeadersInit) =>
    request({ method: 'POST', body: JSON.stringify(body), headers })
  return { db, request, create, services }
}

export type ToolFixture = Awaited<ReturnType<typeof toolFixture>>
