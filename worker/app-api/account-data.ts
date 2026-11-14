import type { AgentModel } from '../../src/shared/generated/AgentModel'
import type { Agent } from '../../src/shared/generated/Agent'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import {
  defaultAgentLoginNoReuse,
  type AgentLoginStatus,
  type NewWorkspaceView,
  type SaveAgentLoginRequest,
} from '../../src/shared/account'

import { agentLoginKind } from '../chat/login-kind'
import { endpointModelList } from './account-models'

interface LoginRow {
  agent: Agent
  kind: string
  endpointOrigin: string | null
  noReuse: number
  updatedAt: number
  modelIds: string | null
  modelsReadAt: number | null
  unusableCause: string | null
}

export async function accountLogins(
  db: D1Database,
  userId: string,
  models: () => readonly AgentModel[],
): Promise<AgentLoginStatus[]> {
  const { results } = await db
    .prepare(
      `SELECT agent, kind, endpoint_origin AS endpointOrigin,
       no_reuse AS noReuse, updated_at AS updatedAt,
       endpoint_model_ids AS modelIds, endpoint_models_read_at AS modelsReadAt, failure_cause AS unusableCause FROM agent_logins
       WHERE user_id = ? ORDER BY agent`,
    )
    .bind(userId)
    .all<LoginRow>()
  return (['claude', 'codex'] as const).map((agent): AgentLoginStatus => {
    const login = results.find((item) => item.agent === agent)
    const loginKind = login ? agentLoginKind(agent, login.kind) : null
    if (!login || !loginKind) return { agent, connected: false }
    const metadata = {
      connected: true as const,
      noReuse: login.noReuse === 1,
      updatedAt: login.updatedAt,
    }
    if (loginKind.kind === 'endpoint') {
      if (!login.endpointOrigin) return { agent, connected: false }
      const modelList = endpointModelList(
        agent,
        login.modelIds,
        login.modelsReadAt,
        models,
      )
      return {
        ...loginKind,
        ...metadata,
        host: new URL(login.endpointOrigin).host,
        ...(modelList ? { modelList } : {}),
      }
    }
    return {
      ...loginKind,
      ...metadata,
      ...(loginKind.agent === 'codex' && login.unusableCause !== null
        ? { unusableCause: login.unusableCause }
        : {}),
    }
  })
}

export async function accountDefault(
  db: D1Database,
  userId: string,
): Promise<AgentChoice | null> {
  const row = await db
    .prepare(
      `SELECT default_agent AS agent, default_model AS model, default_effort AS effort, default_fast AS fast
       FROM user_preferences WHERE user_id = ? AND default_agent IS NOT NULL`,
    )
    .bind(userId)
    .first<Omit<AgentChoice, 'fast'> & { fast: number }>()
  return row ? { ...row, fast: row.fast === 1 } : null
}

/** The saved New workspace view. A new account has none and gets the dialog. */
export async function accountNewWorkspaceView(
  db: D1Database,
  userId: string,
): Promise<NewWorkspaceView> {
  const row = await db
    .prepare(
      'SELECT new_workspace_view AS view FROM user_preferences WHERE user_id = ?',
    )
    .bind(userId)
    .first<{ view: NewWorkspaceView | null }>()
  return row?.view ?? 'dialog'
}

export async function saveAccountNewWorkspaceView(
  db: D1Database,
  userId: string,
  view: NewWorkspaceView,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_preferences (user_id, new_workspace_view, updated_at)
       VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
       new_workspace_view = excluded.new_workspace_view, updated_at = excluded.updated_at`,
    )
    .bind(userId, view, now)
    .run()
}

export async function saveAccountDefault(
  db: D1Database,
  userId: string,
  choice: AgentChoice,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_preferences (user_id, default_agent, default_model, default_effort, default_fast, updated_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
       default_agent = excluded.default_agent, default_model = excluded.default_model,
       default_effort = excluded.default_effort, default_fast = excluded.default_fast, updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      choice.agent,
      choice.model,
      choice.effort,
      choice.fast ? 1 : 0,
      now,
    )
    .run()
}

export async function saveAccountLogin(
  db: D1Database,
  userId: string,
  agent: Agent,
  kind: SaveAgentLoginRequest['kind'],
  ciphertext: string,
  now: number,
  endpointOrigin: string | null = null,
): Promise<boolean> {
  const noReuse = await db
    .prepare(
      `INSERT INTO agent_logins (user_id, agent, kind, ciphertext, endpoint_origin, no_reuse, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, agent) DO UPDATE SET
       kind = excluded.kind, ciphertext = excluded.ciphertext, endpoint_origin = excluded.endpoint_origin,
       no_reuse = CASE WHEN agent_logins.kind = excluded.kind
         THEN agent_logins.no_reuse ELSE excluded.no_reuse END,
       endpoint_model_ids = NULL, endpoint_models_read_at = NULL,
       endpoint_models_attempted_at = NULL, endpoint_models_attempt_id = NULL,
       updated_at = excluded.updated_at, refresh_claim = NULL,
       refresh_claim_until = NULL, failure_cause = NULL RETURNING no_reuse`,
    )
    .bind(
      userId,
      agent,
      kind,
      ciphertext,
      endpointOrigin,
      defaultAgentLoginNoReuse(agent, kind) ? 1 : 0,
      now,
      now,
    )
    .first<number>('no_reuse')
  return noReuse === 1
}

export async function updateAccountLoginReuse(
  db: D1Database,
  userId: string,
  agent: Agent,
  noReuse: boolean,
  models: () => readonly AgentModel[],
): Promise<AgentLoginStatus> {
  await db
    .prepare(
      'UPDATE agent_logins SET no_reuse = ? WHERE user_id = ? AND agent = ?',
    )
    .bind(noReuse ? 1 : 0, userId, agent)
    .run()
  return (
    (await accountLogins(db, userId, models)).find(
      (login) => login.agent === agent,
    ) ?? { agent, connected: false }
  )
}

export async function removeAccountLogin(
  db: D1Database,
  userId: string,
  agent: Agent,
): Promise<void> {
  await db
    .prepare('DELETE FROM agent_logins WHERE user_id = ? AND agent = ?')
    .bind(userId, agent)
    .run()
}
