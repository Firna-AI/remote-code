import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { ProviderOptions } from './providers/types'
import { FakeChild } from '../test-support/child'
import { deferred } from '../test-support/runtime'
import { sessionFixture } from '../test-support/session'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('withholds the close response until agent exit and credential cleanup finish', async () => {
  const child = new FakeChild()
  const killed = deferred<void>()
  child.onKill = () => killed.resolve()
  const cleaning = deferred<void>()
  const release = deferred<void>()
  const cleanup = vi.fn(async () => {
    cleaning.resolve()
    await release.promise
  })
  const h = sessionFixture(async (options) => {
    options.lifetime?.register(child)
    options.lifetime?.registerCleanup(cleanup)
    return h.providers.open(options)
  })
  await h.start()
  const closing = h.request({ type: 'close', requestId: 'close-after-exit' })
  await killed.promise
  try {
    expect(child.signals).toEqual(['SIGTERM'])
    expect(cleanup).toHaveBeenCalledTimes(0)
    expect(h.output).toEqual([
      {
        type: 'event',
        event: { type: 'conversation', id: 'saved-conversation' },
      },
      { type: 'response', requestId: 'start', result: null },
    ])
    expect(h.finish).toHaveBeenCalledTimes(0)
    child.exit()
    await cleaning.promise
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(h.output).toHaveLength(2)
    expect(h.finish).toHaveBeenCalledTimes(0)
  } finally {
    child.exit()
    release.resolve()
  }
  expect(await closing).toEqual({
    type: 'response',
    requestId: 'close-after-exit',
    result: null,
  })
  await h.ended
  expect(h.providers.latest.closed).toBe(true)
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(h.output.slice(2)).toEqual([
    { type: 'response', requestId: 'close-after-exit', result: null },
    { type: 'exit' },
  ])
  expect(h.finish).toHaveBeenCalledTimes(1)
})

it('aborts held setup, cleans up once, and creates no provider after cancellation', async () => {
  const entered = deferred<ProviderOptions>()
  const releaseStart = deferred<void>()
  const cleaning = deferred<void>()
  const releaseCleanup = deferred<void>()
  const cleanup = vi.fn(async () => {
    cleaning.resolve()
    await releaseCleanup.promise
  })
  const h = sessionFixture(async (options) => {
    options.lifetime?.registerCleanup(cleanup)
    entered.resolve(options)
    await releaseStart.promise
    if (options.signal?.aborted) throw new Error('Setup cancelled.')
    return h.providers.open(options)
  })
  const starting = h.start()
  const options = await entered.promise
  const closing = h.request({ type: 'close', requestId: 'cancel-start' })
  await cleaning.promise
  try {
    expect(options.signal?.aborted).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(h.output).toEqual([])
    expect(h.finish).toHaveBeenCalledTimes(0)
  } finally {
    releaseStart.resolve()
    releaseCleanup.resolve()
  }
  expect(await starting).toEqual({
    type: 'error',
    requestId: 'start',
    code: 'agent_failed',
    message: 'Setup cancelled.',
  })
  expect(await closing).toEqual({
    type: 'response',
    requestId: 'cancel-start',
    result: null,
  })
  await h.ended
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(h.providers.processes).toEqual([])
  expect(h.output.at(-1)).toEqual({ type: 'exit' })
  expect(h.finish).toHaveBeenCalledTimes(1)
})
