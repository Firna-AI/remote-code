import type { AgentModel } from '../shared/generated/AgentModel'
import { describe, expect, test } from 'vitest'
import type { AgentChoice } from '../shared/generated/AgentChoice'

import {
  offeredModels,
  unlistedModels,
  type LoginModels,
} from './endpoint-models'

function model(agent: AgentModel['agent'], id: string): AgentModel {
  return { agent, model: id, label: `Label of ${id}`, efforts: ['high'] }
}

const opus = model('claude', 'claude-opus-5-5')
const sonnet = model('claude', 'claude-sonnet-5-5')
const fable = model('claude', 'claude-fable-5-2')
const sol = model('codex', 'gpt-6.1-sol')
const astra = model('codex', 'gpt-6-astra')
const models = [opus, sonnet, fable, sol, astra]

const checkedAt = 1_800_000_000_000

/** An own endpoint login of `agent` whose last list did not name `missing`. */
function listed(
  agent: AgentModel['agent'],
  missing: readonly string[],
): LoginModels {
  return { agent, modelList: { missing, checkedAt } }
}

const choice = (target: AgentModel): AgentChoice => ({
  agent: target.agent,
  model: target.model,
  effort: 'high',
  fast: false,
})

/** The IDs of the models that a picker offers, in their order. */
function offered(
  logins: readonly LoginModels[],
  current?: AgentModel,
): string[] {
  return offeredModels(
    models,
    logins,
    current ? choice(current) : undefined,
  ).map((item) => item.model)
}

describe('the models that the pickers of the owner of an own endpoint offer', () => {
  test('hide each app model that the last list of the login of its agent does not name, and only those', () => {
    expect(offered([listed('claude', [sonnet.model, fable.model])])).toEqual([
      opus.model,
      sol.model,
      astra.model,
    ])
  })

  test('keep the current model of the picker, also when the list does not name it', () => {
    expect(
      offered([listed('claude', [opus.model, sonnet.model])], opus),
    ).toEqual([opus.model, fable.model, sol.model, astra.model])
  })

  test('hide nothing before the first list that worked, and nothing of an agent whose list names none of its app models', () => {
    expect({
      unread: offered([{ agent: 'claude' }, { agent: 'codex' }]),
      noneListed: offered([
        listed('claude', [opus.model, sonnet.model, fable.model]),
        listed('codex', [astra.model]),
      ]),
    }).toEqual({
      unread: models.map((item) => item.model),
      noneListed: [opus.model, sonnet.model, fable.model, sol.model],
    })
  })
})

describe('the models that the account page names for the list of a login', () => {
  test('names the unlisted app models of its agent with the time of the read, and says when the list names none of them', () => {
    expect({
      some: unlistedModels(
        models,
        listed('claude', [fable.model, 'claude-retired-4-0', sol.model]),
      ),
      none: unlistedModels(models, listed('codex', [astra.model, sol.model])),
      every: unlistedModels(models, listed('claude', ['claude-retired-4-0'])),
      unread: unlistedModels(models, { agent: 'claude' }),
    }).toEqual({
      some: { models: [fable], noneListed: false, checkedAt },
      none: { models: [sol, astra], noneListed: true, checkedAt },
      every: null,
      unread: null,
    })
  })
})
