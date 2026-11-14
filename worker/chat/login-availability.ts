import type { Session } from '../../src/shared/generated/Session'
import type { Agent } from '../../src/shared/generated/Agent'
import { readEndpointAddress } from '../../src/shared/endpoint-address'

import { workspaceTokenResourcePredicate } from '../data/workspace-token-access'
import type { AppEnv } from '../env'
import { agentLoginKind } from './login-kind'

export interface SessionLoginTarget {
  sessionId: string
  userId: string
  agent: Agent
}

export type SessionLoginMetadata = Pick<
  Session,
  'loginAvailable' | 'loginShared'
>

export async function readLoginMetadata(
  env: AppEnv,
  workspaceId: string,
  targets: readonly SessionLoginTarget[],
): Promise<ReadonlyMap<string, SessionLoginMetadata>> {
  const rows = await env.DB.prepare(
    `WITH requested AS (
       SELECT json_extract(value, '$.sessionId') AS sessionId,
         json_extract(value, '$.userId') AS userId,
         json_extract(value, '$.agent') AS agent
       FROM json_each(?)
     )
     SELECT requested.sessionId, requested.agent, agent_logins.kind,
       agent_logins.endpoint_origin AS endpointOrigin, agent_logins.no_reuse AS noReuse
     FROM requested
     JOIN workspaces w ON w.id = ? AND ${workspaceTokenResourcePredicate}
     JOIN org_members ON org_members.org_id = w.org_id
       AND org_members.user_id = requested.userId
     JOIN users login_owner ON login_owner.id = org_members.user_id
       AND login_owner.suspended_at IS NULL
     JOIN agent_logins ON agent_logins.user_id = requested.userId
       AND agent_logins.agent = requested.agent AND agent_logins.failure_cause IS NULL`,
  )
    .bind(JSON.stringify(targets), workspaceId)
    .all<{
      sessionId: string
      endpointOrigin: string | null
      agent: Agent
      kind: string
      noReuse: number
    }>()
  const result = new Map<string, SessionLoginMetadata>()
  for (const row of rows.results) {
    const kind = agentLoginKind(row.agent, row.kind)
    if (!kind) continue
    if (
      kind.kind === 'endpoint' &&
      !readEndpointAddress(row.endpointOrigin, row.agent, {
        refusedDomains: env.PREVIEW_DOMAIN ? [env.PREVIEW_DOMAIN] : [],
      })
    )
      continue
    result.set(row.sessionId, {
      loginAvailable: true,
      loginShared: row.noReuse === 0,
    })
  }
  return result
}
