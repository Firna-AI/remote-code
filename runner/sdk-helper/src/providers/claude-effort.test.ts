import { expect, it } from 'vitest'

import {
  claudeEffortSettings,
  claudeStart,
  claudeStartOptions,
} from './claude-effort'

it('starts Ultra at the max level with Ultracode on', () => {
  expect(claudeStartOptions('ultra')).toEqual({
    effort: 'max',
    settings: { ultracode: true },
  })
  expect(claudeStartOptions('max')).toEqual({ effort: 'max' })
  expect(claudeStartOptions('none')).toEqual({
    thinking: { type: 'disabled' },
  })
})

it('names Ultracode in each effort change', () => {
  expect(claudeEffortSettings('ultra')).toEqual({
    effortLevel: 'max',
    ultracode: true,
  })
  expect(claudeEffortSettings('max')).toEqual({
    effortLevel: 'max',
    ultracode: false,
  })
  expect(claudeEffortSettings('none')).toEqual({
    effortLevel: null,
    ultracode: false,
  })
})

it('starts Claude with fast mode beside the settings of its effort', () => {
  expect(
    claudeStart({
      agent: 'claude',
      model: 'opus',
      effort: 'ultra',
      fast: true,
    }),
  ).toEqual({ effort: 'max', settings: { ultracode: true, fastMode: true } })
  expect(
    claudeStart({
      agent: 'claude',
      model: 'opus',
      effort: 'none',
      fast: false,
    }),
  ).toEqual({ thinking: { type: 'disabled' }, settings: { fastMode: false } })
})
