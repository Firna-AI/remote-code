import type { AgentModel } from './generated/AgentModel'
import type { AgentChoice } from './generated/AgentChoice'

import type { Effort } from './generated/Effort'

export const MODELS_PATH = '/api/models'
export interface ModelsResponse {
  models: readonly AgentModel[]
}

/** The effort levels from the lowest, with the words that the picker shows. */
export const effortLabels: Readonly<Record<Effort, string>> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
}

export function findModel(
  models: readonly AgentModel[],
  choice: Pick<AgentChoice, 'agent' | 'model'>,
): AgentModel | undefined {
  return models.find(
    (item) => item.agent === choice.agent && item.model === choice.model,
  )
}

/** The name of a model without its agent's brand, such as "Opus 5.5". */
export function modelLabel(
  models: readonly AgentModel[],
  choice: AgentChoice,
): string {
  return findModel(models, choice)?.label ?? choice.model
}
