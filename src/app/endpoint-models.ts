import type { AgentModel } from '../shared/generated/AgentModel'
import type { Agent } from '../shared/generated/Agent'
import type { AgentChoice } from '../shared/generated/AgentChoice'
import type { EndpointModelList } from '../shared/account'

/**
 * An agent login of the signed-in person, with the last model list of an
 * own endpoint login. Only the owner's account carries the list, and only
 * after a read of the list that worked.
 */
export interface LoginModels {
  agent: Agent
  modelList?: EndpointModelList
}

/**
 * The models of the app that the last model list of an own endpoint login
 * does not name, in the order of the app's list, and the time of that read.
 * When the list names none of the app models of the agent, `noneListed` is
 * true, and the pickers hide none of them, so that each picker keeps a
 * model.
 */
export interface UnlistedModels {
  models: readonly AgentModel[]
  noneListed: boolean
  checkedAt: number
}

/**
 * What the last model list of a login leaves out of the app models of its
 * agent. Null when the list leaves out none of them, and before the first
 * read that worked. An ID that the app does not offer counts for nothing.
 */
export function unlistedModels(
  models: readonly AgentModel[],
  login: LoginModels,
): UnlistedModels | null {
  const list = login.modelList
  if (!list) return null
  const own = models.filter((model) => model.agent === login.agent)
  const unlisted = own.filter((model) => list.missing.includes(model.model))
  if (unlisted.length === 0) return null
  return {
    models: unlisted,
    noneListed: unlisted.length === own.length,
    checkedAt: list.checkedAt,
  }
}

function isChoice(model: AgentModel, choice: AgentChoice | undefined): boolean {
  return choice?.agent === model.agent && choice.model === model.model
}

/**
 * The models that a picker of the owner of `logins` offers: each app model,
 * except one that the last model list of the owner's own endpoint login of
 * its agent does not name. A picker keeps `current`, the model that it
 * shows, also when the list does not name it, so that it never hides the
 * state of its session or its routine.
 */
export function offeredModels(
  models: readonly AgentModel[],
  logins: readonly LoginModels[],
  current: AgentChoice | undefined,
): readonly AgentModel[] {
  const hidden = logins.flatMap((login) => {
    const unlisted = unlistedModels(models, login)
    return unlisted && !unlisted.noneListed ? unlisted.models : []
  })
  if (hidden.length === 0) return models
  return models.filter(
    (model) => !hidden.includes(model) || isChoice(model, current),
  )
}
