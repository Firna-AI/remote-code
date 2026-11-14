import { beforeEach, expect, it, onTestFinished } from 'vitest'

import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { providerFixture } from '../../test-support/fixture'
import { createClaudeFactory } from './claude'
import { ClaudeEvents } from './claude-events'
import type { ProviderEvent } from '../generated/ProviderEvent'

beforeEach(mockComputerServer)

it('completes a whole Claude message after both blocks with the full SDK text before Rust filters credentials', async () => {
  const h = await providerFixture()
  const sdk = new FakeClaudeQuery()
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/pinned/claude',
  )({ ...h.options })
  onTestFinished(() => provider.close())
  await provider.send(turn())
  const user = await sdk.nextUser()
  const frame = (text: string) => ({
    type: 'assistant',
    user_message_uuid: user.uuid,
    message: { id: 'whole-message', content: [{ type: 'text', text }] },
  })
  const stream = (event: unknown) =>
    sdk.raw({ type: 'stream_event', user_message_uuid: user.uuid, event })
  const answers = () =>
    h.events.flatMap((event) => (event.type === 'answer' ? [event] : []))
  const publicText = () =>
    h.events
      .flatMap((event) =>
        event.type === 'delta' || event.type === 'answer' ? [event.text] : [],
      )
      .join('')
  await stream({ type: 'message_start', message: { id: 'whole-message' } })
  await stream({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  await stream({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Login: secret-' },
  })
  await stream({ type: 'content_block_stop', index: 0 })
  await sdk.raw(frame('Login: secret-'))
  expect(answers()).toEqual([])
  expect(publicText()).toBe('Login: secret-')
  await stream({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'text', text: '' },
  })
  await stream({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'text_delta', text: 'alice. Done.' },
  })
  await sdk.raw(frame('alice. Done.'))
  await stream({ type: 'content_block_stop', index: 1 })
  expect(answers()).toEqual([])
  await stream({ type: 'message_stop' })
  expect(answers()).toEqual([
    {
      type: 'answer',
      messageId: 'whole-message',
      text: 'Login: secret-alice. Done.',
      userMessageIds: ['message-1'],
    },
  ])
  expect(publicText()).toBe(
    'Login: secret-alice. Done.Login: secret-alice. Done.',
  )
  expect(h.warnings).toEqual([])
})

it('uses explicit Claude boundaries and fallbacks while retaining identities and user associations', () => {
  const events: ProviderEvent[] = []
  const mapper = new ClaudeEvents(
    new Map([
      ['one', 'message-one'],
      ['two', 'message-two'],
    ]),
    (event) => events.push(event),
    (uuid) => uuid === 'one' || uuid === 'two',
  )
  const frame = (id: string, text: string, uuid = 'one') =>
    mapper.accept({
      type: 'assistant',
      user_message_uuid: uuid,
      message: { id, content: [{ type: 'text', text }] },
    })
  const stream = (event: unknown, uuid = 'one') =>
    mapper.accept({ type: 'stream_event', user_message_uuid: uuid, event })
  stream({ type: 'message_start', message: { id: 'first' } })
  frame('first', 'One ')
  frame('first', 'two.')
  stream({ type: 'content_block_stop', index: 2 })
  expect(events).toEqual([])
  stream({ type: 'message_start', message: { id: 'second' } }, 'two')
  frame('second', 'Tool ', 'two')
  frame('second', 'answer.', 'two')
  mapper.accept({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tool' }] },
  })
  frame('third', 'Result fallback.', 'two')
  mapper.accept({ type: 'result', is_error: false })
  expect(events).toEqual([
    {
      type: 'answer',
      messageId: 'first',
      text: 'One two.',
      userMessageIds: ['message-one'],
    },
    {
      type: 'answer',
      messageId: 'second',
      text: 'Tool answer.',
      userMessageIds: ['message-two'],
    },
    {
      type: 'answer',
      messageId: 'third',
      text: 'Result fallback.',
      userMessageIds: ['message-two'],
    },
    { type: 'result', state: 'finished', userMessageIds: ['message-two'] },
  ])
})
