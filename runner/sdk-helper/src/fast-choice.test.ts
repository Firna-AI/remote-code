import { expect, it } from 'vitest'

import { readRequest } from './read-request'
import { readOutput } from './read-output'

it('preserves fast model requests and speed reports across the helper boundary', () => {
  const choice = { agent: 'codex', model: 'test-model', effort: 'high' }
  for (const fast of [true, false]) {
    const request = {
      type: 'model',
      requestId: 'model-1',
      choice: { ...choice, fast },
    }
    expect(readRequest(request)).toEqual(request)
  }
  expect(readRequest({ type: 'model', requestId: 'older', choice })).toEqual({
    type: 'model',
    requestId: 'older',
    choice: { ...choice, fast: false },
  })
  for (const speed of [
    { state: 'fast' },
    { state: 'standard' },
    { state: 'standard', cause: 'fast_limit' },
  ]) {
    const output = { type: 'event', event: { type: 'speed', speed } }
    expect(readOutput(output)).toEqual(output)
  }
  expect(() =>
    readOutput({
      type: 'event',
      event: { type: 'speed', speed: { state: 'unknown' } },
    }),
  ).toThrow('The helper speed is invalid.')
})
