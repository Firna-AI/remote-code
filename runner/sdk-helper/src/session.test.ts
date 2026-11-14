import { expect, it, vi } from 'vitest'

import { duringTurn, turn } from '../test-support/input'
import { deferred } from '../test-support/runtime'
import { sessionFixture } from '../test-support/session'

it('orders requests and preserves start options, events, results, and request IDs', async () => {
  const h = sessionFixture()
  await h.start()
  const agent = h.providers.latest
  const entered = deferred<void>()
  const release = deferred<void>()
  const send = agent.send.bind(agent)
  vi.spyOn(agent, 'send').mockImplementationOnce(async (input) => {
    entered.resolve()
    await release.promise
    await send(input)
  })
  const choice = {
    agent: 'claude',
    model: 'new-model',
    effort: 'ultra',
    fast: true,
  } as const
  const sending = h.request({
    type: 'send',
    requestId: 'send-first',
    input: h.command,
  })
  const following = h.request({
    type: 'send',
    requestId: 'send-second',
    input: duringTurn(turn('2')),
  })
  const model = h.request({ type: 'model', requestId: 'model', choice })
  const interrupt = h.request({ type: 'interrupt', requestId: 'interrupt' })
  await entered.promise
  try {
    expect(agent.messages).toEqual([])
    expect(agent.choices).toEqual([])
    expect(agent.interrupts).toBe(0)
    expect(h.output).toEqual([
      {
        type: 'event',
        event: { type: 'conversation', id: 'saved-conversation' },
      },
      { type: 'response', requestId: 'start', result: null },
    ])
  } finally {
    release.resolve()
  }
  await Promise.all([sending, following, model, interrupt])
  vi.spyOn(agent, 'model').mockResolvedValueOnce('deferred')
  await h.request({
    type: 'model',
    requestId: 'deferred-model',
    choice: h.options.choice,
  })
  agent.options.backgroundNoteIds?.add('cron:new')
  agent.options.backgroundNotes?.([...(agent.options.backgroundNoteIds ?? [])])
  agent.emit({
    type: 'speed',
    speed: { state: 'standard', cause: 'fast_limit' },
  })
  agent.emit({ type: 'background', live: true, idle: true })
  agent.emit({
    type: 'result',
    state: 'finished',
    userMessageIds: ['message-2'],
  })
  expect(agent.options).toMatchObject({
    ...h.options,
    backgroundNoteIds: new Set(['task:old', 'cron:new']),
  })
  expect(agent.messages.map((input) => input.message.id)).toEqual([
    'message-1',
    'message-2',
  ])
  expect(agent.choices).toEqual([choice])
  expect(agent.interrupts).toBe(1)
  expect(h.output).toEqual([
    {
      type: 'event',
      event: { type: 'conversation', id: 'saved-conversation' },
    },
    { type: 'response', requestId: 'start', result: null },
    { type: 'response', requestId: 'send-first', result: null },
    { type: 'response', requestId: 'send-second', result: null },
    { type: 'response', requestId: 'model', result: 'applied' },
    { type: 'response', requestId: 'interrupt', result: null },
    { type: 'response', requestId: 'deferred-model', result: 'deferred' },
    { type: 'background.notes', ids: ['task:old', 'cron:new'] },
    {
      type: 'event',
      event: {
        type: 'speed',
        speed: { state: 'standard', cause: 'fast_limit' },
      },
    },
    { type: 'event', event: { type: 'background', live: true, idle: true } },
    {
      type: 'event',
      event: {
        type: 'result',
        state: 'finished',
        userMessageIds: ['message-2'],
      },
    },
  ])
  await h.session.close()
})
