import { afterAll, beforeAll, expect, it } from 'vitest'

import { record, string } from '../chat/inputs'
import {
  agentSessionsPath,
  agentSessionMessagesPath,
} from '../../src/shared/agent-session-paths'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import { CLAUDE } from '../chat/harness.test-support'
import { OUTER_WORKSPACE } from '../chat/integration/outer-seed.test-support'
import {
  agentWriteFixture,
  type AgentWriteFixture,
} from '../features/agent-session-writes.test-support'

let fixture: AgentWriteFixture
let bundle: string
beforeAll(async () => {
  bundle = await outerWorkerBundle('worker/features/entry.test-support.ts')
})
beforeAll(async () => {
  fixture = await agentWriteFixture(bundle, {
    configuration: {
      CONDUCTIVE_MODELS: JSON.stringify([
        { ...CLAUDE, label: 'Claude', efforts: ['high'], fast: true },
      ]),
    },
  })
})
afterAll(async () => {
  await fixture.dispose()
})

it('requires fast for a tool session create and keeps session speed on a send without fast', async () => {
  await fixture.env.DB.prepare(
    "INSERT OR REPLACE INTO user_preferences (user_id, default_agent, default_model, default_effort, default_fast, updated_at) VALUES ('member', 'claude', ?, 'high', 1, 1)",
  )
    .bind(CLAUDE.model)
    .run()
  const plain = await fixture.post(agentSessionsPath(), {})
  expect(plain.status).toBe(201)
  expect(await plain.json()).toMatchObject({
    session: { choice: { fast: false } },
  })
  const fast = await fixture.post(agentSessionsPath(), { fast: true })
  expect(fast.status).toBe(201)
  const created = record(await fast.json())
  expect(created).toMatchObject({ session: { choice: { fast: true } } })
  const sessionId = string(record(created.session).id)
  const path = agentSessionMessagesPath('current', sessionId)
  const sent = await fixture.post(path, { text: 'Keep fast' })
  expect(sent.status).toBe(202)
  expect(await sent.json()).toMatchObject({
    session: { workspaceId: OUTER_WORKSPACE, choice: { fast: true } },
    message: { choice: { fast: true } },
  })
  const off = await fixture.post(path, { text: 'Standard', fast: false })
  expect(off.status).toBe(202)
  expect(await off.json()).toMatchObject({
    session: { choice: { fast: false } },
    message: { choice: { fast: false } },
  })
})
