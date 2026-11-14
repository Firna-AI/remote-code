import { afterEach, beforeAll, expect, it } from 'vitest'

import {
  agentSessionsPath,
  agentSessionPath,
  agentMessagePath,
} from '../../src/shared/agent-session-paths'
import { DEVICE_TEST_NOW } from '../devices/clock.test-support'
import { sessionLink } from '../../src/shared/session-link'
import {
  OTHER_WORKSPACE,
  OUTER_WORKSPACE,
} from '../chat/integration/outer-seed.test-support'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import { record, string } from '../chat/inputs'
import {
  agentWriteFixture,
  type AgentWriteFixture,
} from '../features/agent-session-writes.test-support'
import {
  machineRead,
  seedOrderedSessions,
} from './session-management.test-support'

let bundle: string
let fixture: AgentWriteFixture | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle('worker/features/entry.test-support.ts')
})
afterEach(async () => {
  await fixture?.dispose()
})

it('pages all sessions in stable creation order with explicit bounds and more flags', async () => {
  const active = (fixture = await agentWriteFixture(bundle))
  await seedOrderedSessions(active)
  const path = agentSessionsPath(OTHER_WORKSPACE)
  for (const [query, ids, more] of [
    ['', ['closed-session', 'z-session', 'a-session'], undefined],
    ['?limit=1', ['closed-session'], true],
    ['?limit=1&offset=2', ['a-session'], false],
    ['?limit=100', ['closed-session', 'z-session', 'a-session'], false],
    ['?limit=2&offset=3', [], false],
    ['?offset=1', ['z-session', 'a-session'], undefined],
  ] as const) {
    const response = await machineRead(active, path + query)
    expect(response.status).toBe(200)
    const result = record(await response.json())
    if (!Array.isArray(result.sessions)) throw new Error('Missing sessions.')
    expect(
      result.sessions.map((session: unknown) => string(record(session).id)),
      query,
    ).toEqual(ids)
    expect(result.hasMore, query).toBe(more)
  }
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=',
    '?limit=1.5',
    '?offset=-1',
    '?offset=word',
  ]) {
    const response = await machineRead(active, path + query)
    expect(response.status, query).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_input' },
    })
  }
})

it('gets exact session and stored-message facts across workspaces and permits archived reads', async () => {
  const active = (fixture = await agentWriteFixture(bundle))
  const createdResponse = await active.post(
    agentSessionsPath(OTHER_WORKSPACE),
    {
      title: 'Receiving',
      firstMessage: 'Read this stored task',
      requestId: 'read-message',
    },
  )
  expect(createdResponse.status).toBe(201)
  const created = record(await createdResponse.json())
  const sessionId = string(record(created.session).id)
  const message = record(created.message)
  const messageId = string(message.id)
  const response = await machineRead(
    active,
    agentSessionPath(OTHER_WORKSPACE, sessionId),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    workspace: { id: OTHER_WORKSPACE },
    session: {
      id: sessionId,
      title: 'Receiving',
      state: 'running',
      closed: false,
      startedBy: { id: 'member' },
    },
  })
  const read = await machineRead(
    active,
    agentMessagePath(OTHER_WORKSPACE, sessionId, messageId),
  )
  expect(read.status).toBe(200)
  expect(await read.json()).toMatchObject({
    session: { id: sessionId },
    turnId: created.turnId,
    message: {
      id: messageId,
      sessionId,
      sender: { id: 'member' },
      text: `Read this stored task\n\n---\nSent by: ${sessionLink(active.env.APP_ORIGIN, 'chat-org', OUTER_WORKSPACE, active.sourceSessionId)}`,
      state: 'queued',
      createdAt: DEVICE_TEST_NOW,
    },
  })
  const otherSessionId = await active.createSession(OTHER_WORKSPACE)
  for (const [selectedSession, selectedMessage, code] of [
    [otherSessionId, messageId, 'message_not_found'],
    [sessionId, 'missing', 'message_not_found'],
    ['missing-session', messageId, 'session_not_found'],
  ]) {
    const missing = await machineRead(
      active,
      agentMessagePath(OTHER_WORKSPACE, selectedSession, selectedMessage),
    )
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code } })
  }
  await active.env.DB.prepare(
    "UPDATE workspaces SET archived_at = 1, state = 'archived' WHERE id = ?",
  )
    .bind(OTHER_WORKSPACE)
    .run()
  expect(
    (await machineRead(active, agentSessionPath(OTHER_WORKSPACE, sessionId)))
      .status,
  ).toBe(200)
  expect(
    (
      await machineRead(
        active,
        agentMessagePath(OTHER_WORKSPACE, sessionId, messageId),
      )
    ).status,
  ).toBe(200)
  const wrongWorkspace = await machineRead(
    active,
    agentSessionPath(OUTER_WORKSPACE, sessionId),
  )
  expect(wrongWorkspace.status).toBe(404)
  expect(await wrongWorkspace.json()).toMatchObject({
    error: { code: 'session_not_found' },
  })
  expect(
    await (
      await active.actor(OTHER_WORKSPACE)
    ).getAgentSession(
      'other-org',
      OTHER_WORKSPACE,
      sessionId,
      active.env.APP_ORIGIN,
    ),
  ).toMatchObject({ ok: false, error: { code: 'workspace_not_found' } })
})
