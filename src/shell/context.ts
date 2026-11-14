import type { AgentModel } from '../shared/generated/AgentModel'
import { createContext, useContext } from 'react'
import type { AgentChoice } from '../shared/generated/AgentChoice'
import type { AppModel } from '../app/app-model'
import { offeredModels } from '../app/endpoint-models'
import type { OrgModel } from '../app/org-model'
import type { AppServices } from '../app/services'
import { isSuspended, type OrgAccess } from '../app/permissions'
import { useStore } from '../app/store'

import type { OrgSummary } from '../shared/orgs'

export const AppModelContext = createContext<AppModel | null>(null)

/** The shared data of the app: the person, the orgs, and the account. */
export function useApp(): AppModel {
  const app = useContext(AppModelContext)
  if (!app) throw new Error('The app has no model.')
  return app
}

/**
 * The models that a model picker of the person signed in offers: the models
 * of the app, without each one that the last model list of the person's own
 * endpoint login does not name, as `offeredModels` says. The picker keeps
 * `current`, the model that it shows.
 */
export function useOfferedModels(
  current: AgentChoice | undefined,
): readonly AgentModel[] {
  const app = useApp()
  const models = useStore(app.models)
  const account = useStore(app.account.account)
  return offeredModels(models, account?.agentLogins ?? [], current)
}

/** The data of one org, which loads part by part as screens need it. */
export function useOrgModel(orgId: string): OrgModel {
  return useApp().org(orgId)
}

/**
 * The services of one org. Its API client and its fetch take each
 * `org_suspended` refusal, so a page with an old org list turns read-only
 * at once. The feature clients of a workspace send through them.
 */
export function useOrgServices(orgId: string): AppServices {
  return useOrgModel(orgId).services
}

/**
 * What the person signed in may do in an org: their role, and whether the
 * org is suspended, from its summary or from a refusal of the API.
 */
export function useOrgAccess(
  org: Pick<OrgSummary, 'id' | 'role' | 'suspension'>,
): OrgAccess {
  const refused = useStore(useApp().refusedOrgs)
  return { role: org.role, suspended: isSuspended(org, refused) }
}
