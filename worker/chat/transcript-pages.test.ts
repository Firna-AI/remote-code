import type { Session } from '../../src/shared/generated/Session'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  sessionTranscriptPath,
  type SessionTranscriptResponse,
} from '../../src/shared/sessions'
import { heldOperation } from '../test-support/held-operation'
import { createHarness, type TestHarness } from '../test-support/harness'
import { WORKSPACE_ID } from './harness.test-support'
import { CHAT_EVENT_PREFIX, chatEventKey, chatKey } from './storage-keys'
import { transcriptFixture } from './transcript.test-support'

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

it('lets queued writes proceed between pages while keeping the captured session and event cutoff', async () => {
  const fixture = await transcriptFixture(harness)
  const session = await fixture.createSession()
  await fixture.changeWorkspace(WORKSPACE_ID, async (view) => {
    await view.saveSession({ ...session, title: 'Snapshot title' })
    for (let n = 0; n < 70; n++) {
      await view.emit({
        type: 'assistant.completed',
        sessionId: session.id,
        turnId: 'turn',
        messageId: `answer-${n}`,
        text: `Original ${n}`,
        userMessageIds: [],
      })
    }
  })
  const held = heldOperation()
  let first = true
  let sawLaterTitle = false
  let changed: Promise<void> | undefined
  await fixture.setStorageHooks({
    afterList: async (options) => {
      if (options.prefix !== CHAT_EVENT_PREFIX) return
      if (!first) {
        const current = await fixture.storage.get<Session>(
          chatKey('session', session.id),
        )
        sawLaterTitle ||= current?.title === 'Later title'
        return
      }
      first = false
      expect(options.startAfter).toBe(chatEventKey(0))
      await held.wait()
    },
  })
  const copying = fixture.fetch(
    sessionTranscriptPath(fixture.org.id, WORKSPACE_ID, session.id, 'full'),
  )
  let observed:
    Awaited<ReturnType<typeof fixture.observeNextQueued>> | undefined
  try {
    await held.entered
    observed = await fixture.observeNextQueued()
    changed = fixture.changeWorkspace(WORKSPACE_ID, async (view) => {
      await view.saveSession({ ...session, title: 'Later title' })
      await view.emit({
        type: 'assistant.completed',
        sessionId: session.id,
        turnId: 'turn',
        messageId: 'answer-69',
        text: 'New answer after the cutoff',
        userMessageIds: [],
      })
    })
    await observed.queued
    held.release()
    const response = await copying
    expect(response.status).toBe(200)
    const body: SessionTranscriptResponse = await response.json()
    expect(sawLaterTitle).toBe(true)
    expect(body.markdown).toContain('# Snapshot title\n')
    expect(body.markdown).toContain('Original 0\n')
    expect(body.markdown).toContain('Original 69\n')
    expect(body.markdown).not.toContain('New answer after the cutoff')
  } finally {
    held.release()
    await copying
    await observed?.restore()
    await fixture.clearFaults()
    await changed
  }
})
