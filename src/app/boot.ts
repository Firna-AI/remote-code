import type { AgentModel } from '../shared/generated/AgentModel'
import { ACCOUNT_PATHS, type AccountResponse } from '../shared/account'
import { MODELS_PATH } from '../shared/agents'
import { API_PATHS, type User } from '../shared/api'
import { GET_STARTED_PATH, type GetStartedResponse } from '../shared/onboarding'
import type { OrgSummary } from '../shared/orgs'
import type { ApiClient, ApiError } from './api/client'
import { items, record } from './api/parse'
import {
  readAccount,
  readGetStarted,
  readModel,
  readOrg,
} from './api/read-core'
import { asApiError } from './store'

/** The first load of the app, and who it shows the app to. */
export type Boot =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'failed'; error: ApiError }
  /** The person has no app access yet, so the app shows only the waitlist. */
  | { state: 'waiting'; user: User }
  | { state: 'ready'; user: User }

/** What every screen shares, for a person with app access. */
export interface SharedData {
  account: AccountResponse
  orgs: readonly OrgSummary[]
  models: readonly AgentModel[]
  getStarted: GetStartedResponse
}

/** Reads what every screen shares, in parallel. */
export async function readShared(api: ApiClient): Promise<SharedData> {
  const [account, orgs, models, getStarted] = await Promise.all([
    api.get(ACCOUNT_PATHS.account, readAccount),
    api.get(API_PATHS.orgs, (body) => items(record(body), 'orgs', readOrg)),
    api.get(MODELS_PATH, (body) => items(record(body), 'models', readModel)),
    api.get(GET_STARTED_PATH, readGetStarted),
  ])
  return { account, orgs, models, getStarted }
}

/** The boot after a failed load: the sign-in after a refused session, else the error. */
export function failedBoot(error: unknown): Boot {
  const failure = asApiError(error)
  return failure.status === 401
    ? { state: 'signed-out' }
    : { state: 'failed', error: failure }
}
