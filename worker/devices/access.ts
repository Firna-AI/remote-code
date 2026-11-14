import type { DeviceSender } from '../../src/shared/generated/DeviceSender'

import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import type { WorkspaceChat } from '../chat/backend'
import { tokenWorkspace } from '../chat/queries'
import type { AppEnv } from '../env'
import { workspaceTokenAccessPredicate } from '../data/workspace-token-access'
import { workspaceNameColumn } from '../data/workspace-name'
import { HttpError } from '../http'
import { memberSender } from '../tools/store'

export function requestBearer(request: Request): string | null {
  return (
    request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ??
    null
  )
}
export async function machineWorkspace(request: Request, env: AppEnv) {
  if (
    !env.MACHINE_ORIGIN ||
    new URL(request.url).origin !== env.MACHINE_ORIGIN ||
    request.headers.has('Upgrade')
  )
    throw new HttpError(
      403,
      'machine_forbidden',
      'The Mac request is not available.',
    )
  const token = requestBearer(request)
  const workspace = token ? await tokenWorkspace(env.DB, token) : null
  if (!workspace)
    throw new HttpError(
      401,
      'workspace_token_invalid',
      'The workspace login is not valid. Start the workspace again.',
    )
  return workspace
}

export async function activeDeviceSender(
  chat: WorkspaceChat,
  env: AppEnv,
  workspaceId: string,
  turnId: string,
  tokenHash: string,
): Promise<{
  sender: DeviceSender
  sessionId: string
  workspaceName: string | null
}> {
  return chat.store.run(async () => {
    const turn = await activeStoredTurn(chat, workspaceId, turnId)
    if (!turn)
      throw new HttpError(
        403,
        'calling_turn_required',
        'Start this request from an active agent turn.',
      )
    const workspace = await currentCommandAccess(
      env.DB,
      workspaceId,
      turn.senderId,
      tokenHash,
    )
    const sender = workspace
      ? await memberSender(env.DB, workspace.orgId, turn.senderId)
      : null
    if (!workspace || !sender)
      throw new HttpError(
        403,
        'membership_required',
        'The Mac request is not available.',
      )
    return { sender, sessionId: turn.sessionId, workspaceName: workspace.name }
  })
}

/** The caller holds the chat queue. This read does not enter it again. */
export async function activeStoredTurn(
  chat: WorkspaceChat,
  workspaceId: string,
  turnId: string,
) {
  const turn = await chat.store.read(workspaceId, (view) => view.turn(turnId))
  const session = turn
    ? await chat.store.read(workspaceId, (view) => view.session(turn.sessionId))
    : null
  return turn?.state === 'running' &&
    session?.closedAt === null &&
    session.activeTurnId === turn.id
    ? turn
    : null
}
function currentCommandAccess(
  db: D1Database,
  workspaceId: string,
  senderId: string,
  tokenHash: string,
) {
  return db
    .prepare(
      `SELECT w.org_id AS orgId, ${workspaceNameColumn('w')} FROM workspaces w
    JOIN org_members m ON m.org_id = w.org_id AND m.user_id = ?
    JOIN users sender ON sender.id = m.user_id AND sender.suspended_at IS NULL
    JOIN workspace_tokens t ON t.workspace_id = w.id
    WHERE w.id = ? AND ${workspaceTokenAccessPredicate}
    AND w.state NOT IN ('archived', 'stopped', 'error')
    AND t.token_hash = ?`,
    )
    .bind(senderId, workspaceId, tokenHash)
    .first<{ orgId: string; name: string | null }>()
}
export function desktopSessionAlive(
  db: D1Database,
  sessionId: string,
  userId: string,
  now: number,
) {
  return db
    .prepare(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?',
    )
    .bind(sessionId, userId, now)
    .first<{ id: string }>()
}
export function callingTurnId(request: Request): string {
  const value = request.headers.get(TOOL_TURN_HEADER)
  if (!value)
    throw new HttpError(
      403,
      'calling_turn_required',
      'Start this request from an active agent turn.',
    )
  return value
}
