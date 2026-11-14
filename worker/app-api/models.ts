import type { AgentModel } from '../../src/shared/generated/AgentModel'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'

import { choice, identifier, record } from '../chat/inputs'
import type { AppEnv } from '../env'
import { HttpError } from '../http'

export function configuredModels(
  env: Pick<AppEnv, 'CONDUCTIVE_MODELS'>,
): AgentModel[] {
  try {
    const value: unknown = JSON.parse(env.CONDUCTIVE_MODELS ?? '')
    if (!Array.isArray(value) || value.length === 0) throw unavailable()
    return value.map((entry: unknown): AgentModel => {
      const input = record(entry)
      if (!Array.isArray(input.efforts) || input.efforts.length === 0)
        throw unavailable()
      const agentModel = choice({
        agent: input.agent,
        model: input.model,
        effort: input.efforts[0],
      })
      return {
        agent: agentModel.agent,
        model: agentModel.model,
        label: identifier(input.label),
        ...(typeof input.fast === 'boolean' && { fast: input.fast }),
        efforts: input.efforts.map(
          (effort: unknown) => choice({ ...agentModel, effort }).effort,
        ),
      }
    })
  } catch {
    throw unavailable()
  }
}

export function configuredDefaultChoice(
  env: Pick<AppEnv, 'CONDUCTIVE_DEFAULT_CHOICE'>,
): AgentChoice {
  try {
    const value: unknown = JSON.parse(env.CONDUCTIVE_DEFAULT_CHOICE ?? '')
    return { ...choice(value), fast: false }
  } catch {
    throw new HttpError(
      503,
      'default_model_unavailable',
      'The default model is not available. Ask the app administrator to configure it.',
    )
  }
}

function unavailable(): HttpError {
  return new HttpError(
    503,
    'models_unavailable',
    'The models are not available. Ask the app administrator to configure them.',
  )
}

export function modelChoice(env: AppEnv, selected: AgentChoice): AgentChoice {
  return {
    ...selected,
    fast:
      selected.fast === true &&
      configuredModels(env).some(
        (model) =>
          model.agent === selected.agent &&
          model.model === selected.model &&
          model.fast === true,
      ),
  }
}
