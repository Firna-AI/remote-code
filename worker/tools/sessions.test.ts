import { afterEach, beforeAll, expect, it } from 'vitest'

import {
  agentSessionMessagesPath,
  agentSessionTranscriptPath,
  agentSessionsPath,
} from '../../src/shared/agent-session-paths'
import { sessionLink } from '../../src/shared/session-link'
import { sessionPaths } from '../../src/shared/sessions'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import {
  OUTER_ORG,
  OUTER_WORKSPACE,
  OTHER_WORKSPACE,
} from '../chat/integration/outer-seed.test-support'
import { CLAUDE } from '../chat/harness.test-support'
import { record, string } from '../chat/inputs'
import {
  agentWriteFixture,
  type AgentWriteFixture,
} from '../features/agent-session-writes.test-support'
import { machineRead } from './session-management.test-support'

let bundle: string
let fixture: AgentWriteFixture | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle('worker/features/entry.test-support.ts')
})
afterEach(async () => {
  await fixture?.dispose()
})

async function reply(
  response: { status: number; json: () => Promise<unknown> },
  status = 200,
) {
  expect(response.status).toBe(status)
  return record(await response.json())
}

it('creates and reads sessions and replays messages through the stored caller', async () => {
  const active = (fixture = await agentWriteFixture(bundle))
  const opaque = await machineRead(
    active,
    agentSessionTranscriptPath(undefined, '-missing'),
  )
  expect(opaque.status).toBe(404)
  expect(await opaque.json()).toMatchObject({
    error: {
      code: 'session_not_found',
      message: 'The session is not available.',
    },
  })
  const empty = await reply(
    await active.post(agentSessionsPath(), { title: 'keep_name' }),
    201,
  )
  expect(empty).toMatchObject({
    workspace: { id: OUTER_WORKSPACE },
    session: { title: 'keep_name', startedBy: { id: 'member' } },
    message: null,
    turnId: null,
    resume: { state: 'not_needed', error: null },
  })
  const original = '  Review this change.\nKeep this spacing.  '
  const created = await reply(
    await active.post(agentSessionsPath(OTHER_WORKSPACE), {
      firstMessage: original,
      model: { agent: CLAUDE.agent, model: CLAUDE.model },
      effort: 'max',
      requestId: 'cli-create',
    }),
    201,
  )
  const sessionId = string(record(created.session).id)
  const link = sessionLink(
    active.env.APP_ORIGIN,
    OUTER_ORG,
    OTHER_WORKSPACE,
    sessionId,
  )
  const footer = `\n\n---\nSent by: ${sessionLink(active.env.APP_ORIGIN, OUTER_ORG, OUTER_WORKSPACE, active.sourceSessionId)}`
  expect(created).toMatchObject({
    session: { id: sessionId, link, choice: { ...CLAUDE, effort: 'max' } },
    message: { text: original + footer, sender: { id: 'member' } },
    turnId: expect.any(String),
  })
  const send = () =>
    active.post(agentSessionMessagesPath(OTHER_WORKSPACE, sessionId), {
      text: '--help',
      requestId: '..',
    })
  const accepted = await reply(await send(), 202)
  expect(accepted).toMatchObject({
    session: { id: sessionId, link, choice: { ...CLAUDE, effort: 'max' } },
    message: { text: '--help' + footer },
    turnId: created.turnId,
  })
  expect(await reply(await send(), 202)).toEqual(accepted)
  const listed = await reply(await machineRead(active, agentSessionsPath()))
  expect(listed).toMatchObject({ workspace: { id: OUTER_WORKSPACE } })
  expect(listed.sessions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: record(empty.session).id,
        title: 'keep_name',
        closed: false,
      }),
    ]),
  )
  const query = new URLSearchParams({
    detail: 'full',
    startLine: '1',
    startOffset: '0',
  })
  const read = await reply(
    await machineRead(
      active,
      `${agentSessionTranscriptPath(OTHER_WORKSPACE, sessionId)}?${query}`,
    ),
  )
  expect(read).toMatchObject({
    session: { id: sessionId, link },
    detail: 'full',
    startLine: 1,
    startOffset: 0,
    next: null,
  })
  expect(read.markdown).toContain(original + footer)
  expect(read.markdown).toContain('--help' + footer)
})

it('uses caller defaults for session calls and preserves actionable Worker refusals', async () => {
  const active = (fixture = await agentWriteFixture(bundle))
  const created = await reply(
    await active.post(agentSessionsPath(OTHER_WORKSPACE), {
      title: 'MCP review',
    }),
    201,
  )
  const sessionId = string(record(created.session).id)
  expect(created).toMatchObject({
    message: null,
    turnId: null,
    session: { choice: CLAUDE },
  })
  const sent = await reply(
    await active.post(agentSessionMessagesPath(OTHER_WORKSPACE, sessionId), {
      text: '  Work from MCP.  ',
    }),
    202,
  )
  expect(sent).toMatchObject({
    message: {
      text: expect.stringContaining('  Work from MCP.  \n\n---\nSent by: '),
    },
    turnId: expect.any(String),
    session: { id: sessionId, link: record(created.session).link },
  })
  const listed = await reply(await machineRead(active, agentSessionsPath()))
  expect(listed.workspace).toMatchObject({ id: OUTER_WORKSPACE })
  const read = await reply(
    await machineRead(
      active,
      agentSessionTranscriptPath(OTHER_WORKSPACE, sessionId),
    ),
  )
  expect(read).toMatchObject({
    detail: 'concise',
    session: { id: sessionId },
    next: null,
  })
  expect(read.markdown).toContain('Work from MCP.')
  await active.request(
    sessionPaths.close(OUTER_ORG, OTHER_WORKSPACE, sessionId),
    { method: 'POST', body: JSON.stringify({ stopRunningTurn: true }) },
  )
  const refused = await active.post(
    agentSessionMessagesPath(OTHER_WORKSPACE, sessionId),
    { text: 'Closed' },
  )
  expect(refused.status).toBe(409)
  expect(await refused.json()).toMatchObject({
    error: {
      code: 'session_closed',
      message: 'Reopen the session to send a message.',
    },
  })
  const missing = await machineRead(
    active,
    agentSessionTranscriptPath(undefined, 'unknown'),
  )
  expect(missing.status).toBe(404)
  expect(await missing.json()).toMatchObject({
    error: {
      code: 'session_not_found',
      message: 'The session is not available.',
    },
  })
})
