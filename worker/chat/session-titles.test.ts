import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { Attachment } from '../../src/shared/generated/Attachment'
import type { SendMessageResponse } from '../../src/shared/messages'
import { sessionPath, sessionPaths } from '../../src/shared/sessions'
import { createHarness, type TestHarness } from '../test-support/harness'
import { createFirstMessageFixture } from './first-message.test-support'
import { CLAUDE, createChatFixture, WORKSPACE_ID } from './harness.test-support'
import { sessionRecord } from './retry.test-support'

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

it('titles a later session from its first text message and publishes ordered updates to both tabs', async () => {
  const { fixture, first, acceptFirst } =
    await createFirstMessageFixture(harness)
  await acceptFirst()
  const later = await fixture.createSession()
  expect(later.title).toBeNull()
  const ownerTab = await fixture.tab()
  const memberTab = await fixture.tab(0, undefined, fixture.memberCookie)
  const text = 'Name this session.\nKeep this second line out'
  const accepted = await fixture.send(
    later.id,
    'later-message',
    fixture.ownerCookie,
    CLAUDE,
    text,
  )
  expect(accepted.session.title).toBe('Name this session')
  expect((await sessionRecord(fixture, later.id)).title).toBe(
    'Name this session',
  )
  expect((await sessionRecord(fixture, first.sessionId)).title).toBeNull()
  const events = ownerTab.messages.filter((message) => message.type === 'event')
  expect(
    events.map(({ envelope }) => [envelope.eventNumber, envelope.event.type]),
  ).toEqual([
    [5, 'message.accepted'],
    [6, 'session.updated'],
  ])
  expect(events[1].envelope.event).toMatchObject({
    type: 'session.updated',
    session: { id: later.id, title: 'Name this session' },
  })
  const history = await fixture.history(later.id)
  expect(
    await fixture.send(
      later.id,
      'later-message',
      fixture.ownerCookie,
      CLAUDE,
      text,
    ),
  ).toEqual(accepted)
  expect(await fixture.history(later.id)).toEqual(history)
  expect(
    ownerTab.messages.filter((message) => message.type === 'event'),
  ).toEqual(events)
  expect(memberTab.messages).toEqual(ownerTab.messages)
  expect((await fixture.send(later.id, 'another-message')).session.title).toBe(
    'Name this session',
  )
  await ownerTab.close()
  await memberTab.close()
})

it('keeps a member name given to a later session before its first message', async () => {
  const fixture = await createChatFixture(harness)
  const later = await fixture.createSession()
  const renamed = await fixture.fetch(
    sessionPath(fixture.org.id, WORKSPACE_ID, later.id),
    { title: 'New session' },
    fixture.memberCookie,
    'PATCH',
  )
  expect(renamed.status).toBe(200)
  const accepted = await fixture.send(later.id)
  expect(accepted.session.title).toBe('New session')
  expect((await sessionRecord(fixture, later.id)).title).toBe('New session')
})

it('keeps an attachment-only session untitled until it accepts text', async () => {
  const screenshot: Attachment = {
    id: 'screenshot',
    name: 'screen.png',
    path: '.context/attachments/image/screen.png',
    kind: 'image',
    mediaType: 'image/png',
    sizeBytes: 100,
  }
  const fixture = await createChatFixture(harness, {
    resolveAttachments: async (_userId, _workspaceId, ids) => ({
      attachments: ids.length ? [screenshot] : [],
      paths: [],
    }),
  })
  const later = await fixture.createSession()
  const response = await fixture.fetch(
    sessionPaths.messages(fixture.org.id, WORKSPACE_ID, later.id),
    {
      id: 'image-only',
      text: `@${screenshot.path}`,
      choice: CLAUDE,
      attachmentIds: [screenshot.id],
    },
  )
  expect(response.status).toBe(202)
  const accepted: SendMessageResponse = await response.json()
  expect(accepted.session.title).toBeNull()
  await fixture.restart()
  const nextResponse = await fixture.fetch(
    sessionPaths.messages(fixture.org.id, WORKSPACE_ID, later.id),
    {
      id: 'text-after-image',
      text: `Explain @${screenshot.path} with @src/login.ts.`,
      choice: CLAUDE,
      attachmentIds: [screenshot.id],
    },
  )
  expect(nextResponse.status).toBe(202)
  const next: SendMessageResponse = await nextResponse.json()
  expect(next.session.title).toBe('Explain screen.png with @src/login.ts')
  expect((await sessionRecord(fixture, later.id)).title).toBe(
    'Explain screen.png with @src/login.ts',
  )
})
