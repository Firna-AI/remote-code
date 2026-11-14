import { beforeEach, expect, it, onTestFinished } from 'vitest'

import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { string } from '../parse'
import { providerFixture } from '../../test-support/fixture'
import { createClaudeFactory } from './claude'
import { ClaudeEvents } from './claude-events'
import type { ProviderEvent } from '../generated/ProviderEvent'

beforeEach(mockComputerServer)

it('keeps a resumed Claude turn open for its real answer after a background result', async () => {
  const h = await providerFixture()
  const sdk = new FakeClaudeQuery()
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/pinned/claude',
  )({ ...h.options, conversationId: 'saved-sdk-session' })
  onTestFinished(() => provider.close())
  const command = turn()
  command.message.text = 'can you reach the internet?'
  await provider.send(command)
  const uuid = string((await sdk.nextUser()).uuid)
  expect(sdk.parameters?.options?.resume).toBe('saved-sdk-session')
  await sdk.raw({
    type: 'system',
    subtype: 'task_notification',
    task_id: 'old-task',
    status: 'failed',
    summary: 'The old background command stopped.',
  })
  await sdk.raw({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 0,
    result: '',
    origin: { kind: 'task-notification' },
    user_message_uuids: [],
  })
  const ends = () =>
    h.events.flatMap((event) =>
      event.type === 'result' || event.type === 'failed' ? [event] : [],
    )
  expect(ends()).toEqual([])
  expect(sdk.closed).toBe(false)
  await sdk.raw({
    type: 'stream_event',
    user_message_uuid: uuid,
    event: { type: 'message_start', message: { id: 'internet-answer' } },
  })
  await sdk.raw({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'The internet is reachable.' },
    },
  })
  expect(
    h.events.flatMap((event) => (event.type === 'delta' ? [event.text] : [])),
  ).toEqual(['The internet is reachable.'])
  expect(ends()).toEqual([])
  expect(sdk.closed).toBe(false)
  await sdk.raw({
    type: 'result',
    subtype: 'success',
    is_error: false,
    user_message_uuid: uuid,
  })
  expect(
    h.events.flatMap((event) => (event.type === 'answer' ? [event] : [])),
  ).toEqual([
    {
      type: 'answer',
      messageId: 'internet-answer',
      text: 'The internet is reachable.',
      userMessageIds: ['message-1'],
    },
  ])
  expect(ends()).toEqual([
    { type: 'result', state: 'finished', userMessageIds: ['message-1'] },
  ])
  expect(sdk.closed).toBe(false)
  expect(h.warnings).toEqual([])
})

it('keeps an in-progress Claude answer and its user association across a background result', () => {
  const events: ProviderEvent[] = []
  const mapper = new ClaudeEvents(
    new Map([
      ['current-sdk-uuid', 'message-current'],
      ['old-sdk-uuid', 'message-old'],
    ]),
    (event) => events.push(event),
    (uuid) => uuid === 'current-sdk-uuid',
  )
  mapper.accept({
    type: 'stream_event',
    user_message_uuid: 'current-sdk-uuid',
    event: { type: 'message_start', message: { id: 'current-answer' } },
  })
  mapper.accept({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'First ' },
    },
  })
  mapper.accept({
    type: 'result',
    is_error: false,
    origin: { kind: 'task-notification' },
    user_message_uuid: 'old-sdk-uuid',
  })
  expect(events).toEqual([
    { type: 'delta', messageId: 'current-answer', text: 'First ' },
  ])
  mapper.accept({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'reply.' },
    },
  })
  mapper.accept({
    type: 'result',
    is_error: false,
    origin: { kind: 'task-notification' },
    user_message_uuid: 'current-sdk-uuid',
  })
  expect(events).toEqual([
    { type: 'delta', messageId: 'current-answer', text: 'First ' },
    { type: 'delta', messageId: 'current-answer', text: 'reply.' },
    {
      type: 'answer',
      messageId: 'current-answer',
      text: 'First reply.',
      userMessageIds: ['message-current'],
    },
    {
      type: 'result',
      state: 'finished',
      userMessageIds: ['message-current'],
    },
  ])
})
