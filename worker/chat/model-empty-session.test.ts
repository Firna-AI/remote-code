import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type {
  ChangeModelResponse,
  SessionsResponse,
} from '../../src/shared/sessions'
import { sessionPaths, sessionsPath } from '../../src/shared/sessions'
import { createHarness, type TestHarness } from '../test-support/harness'
import {
  CLAUDE,
  CODEX,
  createChatFixture,
  WORKSPACE_ID,
} from './harness.test-support'

describe('a model of the other agent in a session with no turn', () => {
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

  it('changes the agent in place until the first message, then opens a new session', async () => {
    const fixture = await createChatFixture(harness)
    const session = await fixture.createSession()
    await harness.env.DB.prepare(
      "DELETE FROM agent_logins WHERE user_id = ? AND agent = 'codex'",
    )
      .bind(fixture.owner.id)
      .run()
    const draft = { text: 'Keep this draft.', attachmentIds: [] }
    const change = async (choice: AgentChoice, newSessionId: string) => {
      const response = await fixture.fetch(
        sessionPaths.model(fixture.org.id, WORKSPACE_ID, session.id),
        { choice, draft, newSessionId },
        fixture.ownerCookie,
        'PUT',
      )
      expect(response.status).toBe(200)
      const body: ChangeModelResponse = await response.json()
      return body
    }

    const toCodex = await change(CODEX, 'codex-session')
    expect(toCodex.created).toBe(false)
    expect(toCodex.draft).toEqual(draft)
    expect(toCodex.session).toMatchObject({
      id: session.id,
      choice: CODEX,
      startedBy: { id: fixture.owner.id },
      loginAvailable: false,
    })
    const sessions: SessionsResponse = await (
      await fixture.fetch(sessionsPath(fixture.org.id, WORKSPACE_ID))
    ).json()
    expect(sessions.sessions.map((entry) => entry.id)).toEqual([session.id])

    const toClaude = await change(CLAUDE, 'claude-session')
    expect(toClaude.created).toBe(false)
    expect(toClaude.session).toMatchObject({
      id: session.id,
      choice: CLAUDE,
      loginAvailable: true,
    })

    await fixture.send(session.id)
    const opened = await change(CODEX, 'later-codex-session')
    expect(opened.created).toBe(true)
    expect(opened.session.id).toBe('later-codex-session')
    expect(opened.session.sourceSessionId).toBeNull()
  })
})
