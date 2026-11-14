import { beforeEach, expect, it, onTestFinished } from 'vitest'

import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { duringTurn, turn } from '../../test-support/input'
import { fakeToolContext } from '../../test-support/input'
import { string } from '../parse'
import { providerFixture } from '../../test-support/fixture'
import { createClaudeFactory } from './claude'

beforeEach(mockComputerServer)

async function queuedClaudeTurn() {
  const h = await providerFixture()
  const sdk = new FakeClaudeQuery()
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/pinned/claude',
  )(h.options)
  onTestFinished(() => provider.close())
  const first = turn()
  first.message.text = 'Message 1.'
  await provider.send(first)
  for (let id = 2; id <= 65; id++)
    await provider.send({
      ...duringTurn(turn(String(id))),
      type: 'message',
      turnId: 'turn-1',
      message: { ...turn(String(id)).message, text: `Message ${id}.` },
    })
  const sent: string[] = []
  for (let id = 1; id <= 64; id++) {
    const message = await sdk.nextUser()
    expect(message.message).toEqual({
      role: 'user',
      content: `Sender: @alice [member ID: "alice"]\n\nMessage ${id}.`,
    })
    sent.push(string(message.uuid))
  }
  return { ...h, provider, sdk, sent }
}

it('holds the 65th Claude message until a result frees input and reports exact message IDs', async () => {
  const h = await queuedClaudeTurn()
  let delivered = false
  const pending = h.sdk.nextInput().then((message) => {
    delivered = !message.done
    return message.done ? null : message.value
  })
  await h.sdk.raw({ type: 'system', subtype: 'init', session_id: 'sdk-ready' })
  expect(delivered).toBe(false)
  await h.sdk.raw({
    type: 'result',
    is_error: false,
    origin: { kind: 'task-notification' },
    user_message_uuids: h.sent,
  })
  const last = await pending
  expect(delivered).toBe(true)
  expect(last?.message).toEqual({
    role: 'user',
    content: 'Sender: @alice [member ID: "alice"]\n\nMessage 65.',
  })
  expect(h.sent).not.toContain(last?.uuid)
  const completed = () =>
    h.events.flatMap((event) => (event.type === 'result' ? [event] : []))
  expect(completed()).toEqual([
    {
      type: 'result',
      state: 'finished',
      userMessageIds: Array.from(
        { length: 64 },
        (_, index) => `message-${index + 1}`,
      ),
    },
  ])
  await h.sdk.raw({
    type: 'stream_event',
    user_message_uuid: last?.uuid,
    event: { type: 'message_start', message: { id: 'held-answer' } },
  })
  await h.sdk.raw({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Queued reply.' },
    },
  })
  await h.sdk.raw({
    type: 'result',
    is_error: false,
    origin: { kind: 'task-notification' },
    user_message_uuids: h.sent,
  })
  expect(
    h.events.flatMap((event) => (event.type === 'answer' ? [event] : [])),
  ).toEqual([])
  expect(completed()).toEqual([
    {
      type: 'result',
      state: 'finished',
      userMessageIds: Array.from(
        { length: 64 },
        (_, index) => `message-${index + 1}`,
      ),
    },
  ])
  await h.sdk.raw({ type: 'result', is_error: false })
  expect(completed()).toEqual([
    {
      type: 'result',
      state: 'finished',
      userMessageIds: Array.from(
        { length: 64 },
        (_, index) => `message-${index + 1}`,
      ),
    },
    { type: 'result', state: 'finished', userMessageIds: ['message-65'] },
  ])
  expect(h.warnings).toEqual([])
})

it('frees Claude input only for explicitly listed outstanding SDK UUIDs on each result', async () => {
  const h = await providerFixture()
  const sdk = new FakeClaudeQuery()
  const first = turn()
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/pinned/claude',
  )({
    cwd: h.root,
    home: h.home,
    sessionId: first.sessionId,
    endpoint:
      fakeToolContext.machineOrigin + '/v1/model/' + first.message.choice.agent,
    credential: { type: 'gateway', ...first.credential },
    commitAuthor: null,
    choice: first.message.choice,
    conversationId: null,
    instructions: '',
    tools: fakeToolContext,
    event: () => {},
    warn: h.options.warn,
  })
  onTestFinished(() => provider.close())
  for (let id = 1; id <= 65; id++) await provider.send(turn(String(id)))
  const sent: string[] = []
  for (let id = 1; id <= 64; id++)
    sent.push(string((await sdk.nextUser()).uuid))
  let delivered = false
  const pending = sdk.nextUser().then((message) => {
    delivered = true
    return message
  })
  await sdk.raw({
    type: 'assistant',
    user_message_uuid: sent[0],
    message: { id: 'retained-association', content: [] },
  })
  await sdk.raw({ type: 'result', is_error: false })
  expect(delivered).toBe(false)
  await sdk.raw({ type: 'result', is_error: false, user_message_uuids: [] })
  expect(delivered).toBe(false)
  await sdk.raw({
    type: 'result',
    is_error: false,
    user_message_uuids: ['unknown-sdk-uuid'],
  })
  expect(delivered).toBe(false)
  await sdk.raw({ type: 'result', is_error: false, user_message_uuid: sent[0] })
  const last = await pending
  await provider.send(turn('66'))
  let nextDelivered = false
  const next = sdk.nextUser().then((message) => {
    nextDelivered = true
    return message
  })
  await sdk.raw({
    type: 'result',
    is_error: false,
    user_message_uuids: [sent[0]],
  })
  expect(nextDelivered).toBe(false)
  await sdk.raw({
    type: 'result',
    is_error: false,
    user_message_uuids: [last.uuid],
  })
  expect((await next).message).toEqual({
    role: 'user',
    content: 'Sender: @alice [member ID: "alice"]\n\nChange the file.',
  })
})

it('discards the held 65th Claude message when Stop closes SDK input', async () => {
  const h = await queuedClaudeTurn()
  let delivered = false
  const pending = h.sdk.nextInput().then((message) => {
    delivered = true
    return message
  })
  await h.sdk.raw({ type: 'system', subtype: 'init', session_id: 'sdk-ready' })
  expect(delivered).toBe(false)
  await h.provider.stop()
  expect(await pending).toEqual({ done: true, value: undefined })
  expect(h.sdk.closed).toBe(true)
  expect(h.warnings).toEqual([])
})
