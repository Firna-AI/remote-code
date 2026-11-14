import type { Session } from '../../src/shared/generated/Session'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { createHarness, type TestHarness } from '../test-support/harness'
import { isRecord } from '../http'
import { createChatFixture, type ChatFixture } from './harness.test-support'
import { retryRequest, sessionRecord } from './retry.test-support'
import { startTurn, terminalEvent } from './turn-lifecycle.test-support'
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
it('preserves legacy history with an unknown starter and sends retries and new messages into fresh linked sessions', async () => {
  const fixture = await createChatFixture(harness)
  const source = await fixture.createSession()
  const runner = await fixture.connect()
  runner.emit({ type: 'runner.ready' })
  await fixture.drain()
  const original = await startTurn(fixture, runner, source.id, 'legacy-message')
  runner.emit(terminalEvent(original, 'failed'))
  await fixture.drain()
  const before = await fixture.history(source.id)
  await removeMetadata(fixture, source.id)
  await fixture.restart()
  expect(await sessionRecord(fixture, source.id)).toMatchObject({
    startedBy: null,
    sourceSessionId: null,
    loginAvailable: false,
    loginShared: true,
    retryMessageId: 'legacy-message',
  })
  const history = await fixture.history(source.id)
  expect(history.throughEventNumber).toBe(before.throughEventNumber)
  expect(history.events.map(({ event }) => event.type)).toEqual(
    before.events.map(({ event }) => event.type),
  )
  expect(
    history.events.filter(({ event }) => event.type === 'message.accepted'),
  ).toMatchObject([
    {
      event: {
        message: { id: 'legacy-message', sender: { id: fixture.owner.id } },
      },
    },
  ])
  const records = history.events.flatMap(({ event }) =>
    event.type === 'session.updated' ? [event.session] : [],
  )
  expect(
    records.map(
      ({ startedBy, sourceSessionId, loginAvailable, loginShared }) => ({
        startedBy,
        sourceSessionId,
        loginAvailable,
        loginShared,
      }),
    ),
  ).toEqual([
    {
      startedBy: null,
      sourceSessionId: null,
      loginAvailable: false,
      loginShared: true,
    },
    {
      startedBy: null,
      sourceSessionId: null,
      loginAvailable: false,
      loginShared: true,
    },
    {
      startedBy: null,
      sourceSessionId: null,
      loginAvailable: false,
      loginShared: true,
    },
  ])
  const ownerTab = await fixture.tab()
  const memberTab = await fixture.tab(0, undefined, fixture.memberCookie)
  expect(memberTab.messages).toEqual(ownerTab.messages)
  const response = await retryRequest(
    fixture,
    source.id,
    'legacy-message',
    fixture.memberCookie,
  )
  expect(response.status).toBe(202)
  const linked: {
    session: Session
  } = await response.json()
  expect(linked.session).toMatchObject({
    startedBy: { id: fixture.member.id },
    sourceSessionId: source.id,
    loginAvailable: true,
    loginShared: true,
  })
  const sent = await fixture.send(source.id, 'new-legacy-message')
  expect(sent.session.id).not.toBe(linked.session.id)
  expect(sent.session).toMatchObject({
    startedBy: { id: fixture.owner.id },
    sourceSessionId: source.id,
  })
  expect((await sessionRecord(fixture, source.id)).startedBy).toBeNull()
  await ownerTab.close()
  await memberTab.close()
  const empty = await fixture.createSession()
  const emptyBefore = await fixture.history(empty.id)
  await removeMetadata(fixture, empty.id, true)
  const emptyRecord = await sessionRecord(fixture, empty.id)
  expect(emptyRecord.retryMessageId).toBeNull()
  expect(emptyRecord).toMatchObject({
    startedBy: null,
    sourceSessionId: null,
    loginAvailable: false,
    loginShared: true,
  })
  const emptyHistory = await fixture.history(empty.id)
  expect(emptyHistory.events.map(({ eventNumber }) => eventNumber)).toEqual(
    emptyBefore.events.map(({ eventNumber }) => eventNumber),
  )
  expect(
    emptyHistory.events.flatMap(({ event }) =>
      event.type === 'session.updated' ? [event.session.retryMessageId] : [],
    ),
  ).toEqual([null])
})
async function removeMetadata(
  fixture: ChatFixture,
  sessionId: string,
  omitRetry = false,
) {
  const without = (value: Record<string, unknown>) => {
    const result = { ...value }
    delete result.startedBy
    delete result.sourceSessionId
    delete result.loginAvailable
    delete result.loginShared
    if (omitRetry) delete result.retryMessageId
    return result
  }
  for (const [key, value] of (await fixture.snapshot()).records) {
    if (!isRecord(value)) continue
    if (value.id === sessionId && 'choice' in value)
      await fixture.storage.put(key, without(value))
    const event = value.event
    if (
      isRecord(event) &&
      event.type === 'session.updated' &&
      isRecord(event.session) &&
      event.session.id === sessionId
    )
      await fixture.storage.put(key, {
        ...value,
        event: { ...event, session: without(event.session) },
      })
  }
}
