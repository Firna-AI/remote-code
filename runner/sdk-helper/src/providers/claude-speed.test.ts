import { expect, it } from 'vitest'

import { ClaudeEvents } from './claude-events'
import type { ProviderEvent } from '../generated/ProviderEvent'

it.each([
  {
    name: 'enabled result',
    frames: [{ type: 'result', fast_mode_state: 'on' }],
    speed: { state: 'fast' },
  },
  {
    name: 'cooldown result',
    frames: [{ type: 'result', fast_mode_state: 'cooldown' }],
    speed: { state: 'standard', cause: 'fast_limit' },
  },
  {
    name: 'disabled result',
    frames: [
      {
        type: 'result',
        fast_mode_state: 'off',
        fast_mode_disabled_reason: 'extra_usage_disabled',
      },
    ],
    speed: { state: 'standard', cause: 'extra_usage_disabled' },
  },
  {
    name: 'unknown disabled cause',
    frames: [{ type: 'result', fast_mode_state: 'off' }],
    speed: { state: 'standard' },
  },
  {
    name: 'missing result state',
    frames: [{ type: 'result' }],
    speed: { state: 'fast' },
  },
  {
    name: 'credits fallback with state still on',
    frames: [
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          overageStatus: 'rejected',
          overageDisabledReason: 'out_of_credits',
        },
      },
      {
        type: 'system',
        subtype: 'notification',
        key: 'fast-mode-overage-rejected',
      },
      { type: 'result', fast_mode_state: 'on' },
    ],
    speed: { state: 'standard', cause: 'out_of_credits' },
  },
  {
    name: 'rate-limit reason alone is not fallback',
    frames: [
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          overageDisabledReason: 'out_of_credits',
        },
      },
      { type: 'result', fast_mode_state: 'on' },
    ],
    speed: { state: 'fast' },
  },
  {
    name: 'notice without reason',
    frames: [
      {
        type: 'system',
        subtype: 'notification',
        key: 'fast-mode-overage-rejected',
      },
      { type: 'result', fast_mode_state: 'on' },
    ],
    speed: { state: 'standard' },
  },
  {
    name: 'notice then rate-limit reason',
    frames: [
      {
        type: 'system',
        subtype: 'notification',
        key: 'fast-mode-overage-rejected',
      },
      {
        type: 'rate_limit_event',
        rate_limit_info: {
          overageStatus: 'rejected',
          overageDisabledReason: 'org_level_disabled',
        },
      },
      { type: 'result', fast_mode_state: 'on' },
    ],
    speed: { state: 'standard', cause: 'org_level_disabled' },
  },
  {
    name: 'fallback model notice',
    frames: [
      {
        type: 'system',
        subtype: 'notification',
        key: 'fast-mode-fallback-model-rejected',
      },
      { type: 'result', fast_mode_state: 'on' },
    ],
    speed: { state: 'standard' },
  },
  {
    name: 'cooldown notice survives reset',
    frames: [
      {
        type: 'system',
        subtype: 'notification',
        key: 'fast-mode-cooldown-started',
      },
      {
        type: 'system',
        subtype: 'notification',
        key: 'fast-mode-cooldown-expired',
      },
      { type: 'result', fast_mode_state: 'on' },
    ],
    speed: { state: 'standard', cause: 'fast_limit' },
  },
])('reports $name for a fast Claude turn', ({ frames, speed }) => {
  const events: ProviderEvent[] = []
  const mapper = new ClaudeEvents(
    new Map(),
    (event) => events.push(event),
    () => true,
    undefined,
    true,
  )
  for (const frame of frames) mapper.accept({ is_error: false, ...frame })
  expect(events.filter((event) => event.type === 'speed').at(-1)).toEqual({
    type: 'speed',
    speed,
  })
})

it('does not report speed for a standard Claude turn', () => {
  const events: ProviderEvent[] = []
  const mapper = new ClaudeEvents(
    new Map(),
    (event) => events.push(event),
    () => true,
  )
  mapper.accept({ type: 'result', fast_mode_state: 'off' })
  expect(events.filter((event) => event.type === 'speed')).toEqual([])
})
