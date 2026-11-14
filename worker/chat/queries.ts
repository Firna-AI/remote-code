import type { Agent } from '../../src/shared/generated/Agent'
import type { AppEnv } from '../env'
import { CODEX_RECONNECT_CAUSE, parseCodexTokens } from '../codex-auth/tokens'
import { failCodexRefresh } from '../codex-auth/token-store'
import {
  workspaceTokenAccessPredicate,
  workspaceTokenResourcePredicate,
} from '../data/workspace-token-access'
import { decrypt, hash } from '../security/crypto'
import { workspaceNameColumn } from '../data/workspace-name'
import {
  agentLoginKind,
  type AgentLogin,
  type AgentLoginKind,
} from './login-kind'
import type { RunnerWorkspaceRecord, WorkspaceRecord } from './types'

const workspaceColumns = `w.id, w.org_id AS orgId, w.archived_at AS archivedAt`

const automaticTitleWorkspacePredicate = `archived_at IS NULL AND state != 'archived'
  AND EXISTS (SELECT 1 FROM orgs WHERE orgs.id = workspaces.org_id
    AND orgs.deleted_at IS NULL AND orgs.suspended_at IS NULL)`

export async function readAutomaticTitleWorkspace(
  db: D1Database,
  workspaceId: string,
): Promise<{ name: string | null } | null> {
  return db
    .prepare(
      `SELECT ${workspaceNameColumn('workspaces')} FROM workspaces WHERE id = ? AND ${automaticTitleWorkspacePredicate}`,
    )
    .bind(workspaceId)
    .first<{ name: string | null }>()
}

export function findChatWorkspace(
  db: D1Database,
  orgId: string,
  workspaceId: string,
): Promise<(WorkspaceRecord & { number: number }) | null> {
  return db
    .prepare(
      `SELECT ${workspaceColumns}, w.number FROM workspaces w
     JOIN orgs ON orgs.id = w.org_id
     WHERE w.id = ? AND w.org_id = ? AND orgs.deleted_at IS NULL`,
    )
    .bind(workspaceId, orgId)
    .first<WorkspaceRecord & { number: number }>()
}

export async function updateWorkspaceTitle(
  db: D1Database,
  workspaceId: string,
  name: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspaces SET name = ?, updated_at = MAX(updated_at, ?)
    WHERE id = ? AND name = '' AND ${automaticTitleWorkspacePredicate}`,
    )
    .bind(name, now, workspaceId)
    .run()
}

export async function tokenWorkspace(
  db: D1Database,
  token: string,
): Promise<RunnerWorkspaceRecord | null> {
  return db
    .prepare(
      `SELECT ${workspaceColumns}, t.token_hash AS tokenHash FROM workspace_tokens t
     JOIN workspaces w ON w.id = t.workspace_id
     WHERE t.token_hash = ? AND ${workspaceTokenAccessPredicate}`,
    )
    .bind(await hash(token))
    .first<RunnerWorkspaceRecord>()
}

/** The account-login writer must use this authenticated encryption context. */
export function agentLoginContext(userId: string, agent: Agent): string {
  return `agent-login:${userId}:${agent}`
}

/**
 * A login never holds whitespace. A token that a terminal wrapped can arrive
 * with a space or a line break inside it, so each save and read removes them.
 */
export function loginSecret(value: string): string {
  return value.replace(/\s+/g, '')
}

export async function readAgentLogin(
  env: AppEnv,
  userId: string,
  agent: Agent,
): Promise<AgentLogin | null> {
  const row = await env.DB.prepare(
    'SELECT kind, ciphertext FROM agent_logins WHERE user_id = ? AND agent = ? AND failure_cause IS NULL',
  )
    .bind(userId, agent)
    .first<{ kind: string; ciphertext: string }>()
  const loginKind = row ? agentLoginKind(agent, row.kind) : null
  if (!row || !loginKind) return null
  const login = await decryptAgentLogin(env, userId, loginKind, row.ciphertext)
  if (
    login?.agent === 'codex' &&
    login.kind === 'token' &&
    !parseCodexTokens(login.secret)
  ) {
    await failCodexRefresh(
      env.DB,
      userId,
      row.ciphertext,
      null,
      CODEX_RECONNECT_CAUSE,
    )
    return null
  }
  return login
}

export async function decryptAgentLogin(
  env: AppEnv,
  userId: string,
  kind: AgentLoginKind,
  ciphertext: string,
): Promise<AgentLogin | null> {
  const plaintext = await decrypt(
    ciphertext,
    agentLoginContext(userId, kind.agent),
    env.BOAT_KEY_ENCRYPTION_KEY,
  )
  if (kind.kind !== 'endpoint')
    return {
      ...kind,
      secret:
        kind.agent === 'codex' && kind.kind === 'token'
          ? plaintext
          : loginSecret(plaintext),
    }
  const value: unknown = JSON.parse(plaintext)
  if (
    !value ||
    typeof value !== 'object' ||
    !('endpoint' in value) ||
    typeof value.endpoint !== 'string' ||
    !('secret' in value) ||
    typeof value.secret !== 'string'
  )
    return null
  return {
    ...kind,
    endpoint: value.endpoint,
    secret: loginSecret(value.secret),
  }
}

export async function senderLoginAccess(
  db: D1Database,
  workspaceId: string,
  loginOwnerId: string | null,
  agent: Agent,
  runnerTokenHash?: string,
  senderId?: string,
): Promise<{
  senderAllowed: boolean
  loginOwnerAllowed: boolean
  runnerAllowed: boolean
  reuseAllowed: boolean
}> {
  const row = await db
    .prepare(
      `SELECT
       CASE WHEN ${workspaceTokenResourcePredicate} THEN 1 ELSE 0 END AS workspaceAllowed,
       EXISTS(SELECT 1 FROM org_members JOIN users sender ON sender.id = org_members.user_id
         WHERE org_id = w.org_id AND user_id = ? AND sender.suspended_at IS NULL) AS senderAllowed,
       EXISTS(SELECT 1 FROM org_members JOIN users login_owner ON login_owner.id = org_members.user_id
         WHERE org_id = w.org_id AND user_id = ? AND login_owner.suspended_at IS NULL) AS loginOwnerAllowed,
       EXISTS(SELECT 1 FROM agent_logins WHERE user_id = ? AND agent = ?
         AND kind != 'endpoint' AND no_reuse = 1 AND user_id != ?) AS reuseDenied,
       EXISTS(SELECT 1 FROM workspace_tokens t WHERE t.workspace_id = w.id
         AND t.token_hash = ? AND ${workspaceTokenAccessPredicate}) AS runnerAllowed
     FROM workspaces w WHERE w.id = ?`,
    )
    .bind(
      senderId ?? loginOwnerId,
      loginOwnerId,
      loginOwnerId,
      agent,
      senderId ?? loginOwnerId,
      runnerTokenHash ?? null,
      workspaceId,
    )
    .first<{
      workspaceAllowed: number
      senderAllowed: number
      loginOwnerAllowed: number
      runnerAllowed: number
      reuseDenied: number
    }>()
  return {
    senderAllowed: row?.workspaceAllowed === 1 && row.senderAllowed === 1,
    loginOwnerAllowed:
      row?.workspaceAllowed === 1 && row.loginOwnerAllowed === 1,
    runnerAllowed: row?.workspaceAllowed === 1 && row.runnerAllowed === 1,
    reuseAllowed: row?.reuseDenied !== 1,
  }
}

/** The transcript keeps the workspace name captured with its session. */
export function transcriptWorkspaceName(
  db: D1Database,
  workspaceId: string,
): Promise<{ name: string | null } | null> {
  return db
    .prepare(
      `SELECT ${workspaceNameColumn('workspaces')} FROM workspaces WHERE id = ?`,
    )
    .bind(workspaceId)
    .first<{ name: string | null }>()
}
