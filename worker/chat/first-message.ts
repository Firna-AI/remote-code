import type { UserMessage } from '../../src/shared/generated/UserMessage'
import type { User } from '../../src/shared/api'
import type { AppEnv } from '../env'
import { sessionTitleFrom } from '../../src/shared/session-title'
import { HttpError } from '../http'
import type { FirstWorkspaceMessage } from '../lifecycle/workspace-runtime'
import { acceptMessage, existingMessage } from './messages'
import { createSession } from './sessions'
import type { ChatTransaction } from './store'
import type { ChatDependencies } from './types'

interface FirstMessageIdentity extends User {
  archivedAt: number | null
  orgId: string
  sessionId: string
  turnId: string
  messageId: string
  agent: string
  model: string
  effort: string
  fast: number
}

export function firstMessageIdentity(
  env: AppEnv,
  workspaceId: string,
): Promise<FirstMessageIdentity | null> {
  return env.DB.prepare(
    `SELECT u.id, u.github_id AS githubId, u.github_login AS githubLogin,
    u.display_name AS displayName, u.avatar_url AS avatarUrl,
    w.archived_at AS archivedAt,
    r.org_id AS orgId, r.session_id AS sessionId, r.first_turn_id AS turnId,
    r.first_message_id AS messageId, r.agent, r.model, r.effort, r.fast
    FROM workspace_runtime r JOIN workspaces w ON w.id = r.workspace_id
    JOIN orgs o ON o.id = w.org_id
    JOIN users u ON u.id = r.created_by_user_id
    JOIN org_members m ON m.org_id = w.org_id AND m.user_id = u.id
    WHERE w.id = ? AND w.org_id = r.org_id AND o.deleted_at IS NULL`,
  )
    .bind(workspaceId)
    .first<FirstMessageIdentity>()
}

export function requireFirstMessage(
  identity: FirstMessageIdentity | null,
  first: FirstWorkspaceMessage,
): User {
  if (
    !identity ||
    identity.id !== first.sender.id ||
    identity.sessionId !== first.sessionId ||
    identity.turnId !== first.turnId ||
    identity.messageId !== first.request.id ||
    identity.agent !== first.request.choice.agent ||
    identity.model !== first.request.choice.model ||
    identity.effort !== first.request.choice.effort ||
    (identity.fast === 1) !== (first.request.choice.fast ?? false)
  )
    throw new HttpError(
      404,
      'workspace_not_found',
      'The workspace is not available.',
    )
  return {
    id: identity.id,
    githubId: identity.githubId,
    githubLogin: identity.githubLogin,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
  }
}

export async function admitFirstMessage(
  transaction: ChatTransaction,
  first: FirstWorkspaceMessage,
  sender: User,
  dependencies: ChatDependencies,
  archived: boolean,
): Promise<UserMessage> {
  first = {
    ...first,
    request: {
      ...first.request,
      choice: dependencies.normalizeChoice(first.request.choice),
    },
  }
  const existing = await existingMessage(
    transaction,
    first.sessionId,
    first.request,
    sender,
  )
  if (existing) {
    if ((await transaction.messageTurn(existing.message.id)) !== first.turnId)
      throw new HttpError(
        409,
        'message_id_conflict',
        'Send the changed message with a new message ID.',
      )
    return existing.message
  }
  if (archived)
    throw new HttpError(
      409,
      'workspace_archived',
      'The archived chat is read-only.',
    )
  if (
    (await transaction.session(first.sessionId)) ||
    (await transaction.turn(first.turnId))
  )
    throw new HttpError(
      409,
      'message_id_conflict',
      'Send the changed message with a new message ID.',
    )
  const login = await dependencies.resolveLogin(
    sender.id,
    first.request.choice.agent,
  )
  if (!login || login.agent !== first.request.choice.agent)
    throw new HttpError(
      409,
      'agent_login_required',
      'Connect your agent login to send a message.',
    )
  const attachments = await dependencies.resolveAttachments(
    sender.id,
    first.workspaceId,
    first.request.attachmentIds,
    first.request.id,
    await transaction.usedAttachments(first.request.attachmentIds, sender.id),
  )
  await transaction.saveFirstSession({
    id: first.sessionId,
    messageId: first.request.id,
  })
  const session = await createSession(
    transaction,
    first.request.choice,
    first.sessionId,
    sender,
    dependencies,
  )
  const title =
    first.firstSessionTitle === undefined
      ? null
      : sessionTitleFrom(first.firstSessionTitle)
  if (title !== null) {
    session.title = title
    await transaction.saveSession(session)
    await transaction.emit({ type: 'session.updated', session })
  }
  let turnId = first.turnId
  const accepted = await acceptMessage(
    transaction,
    first.sessionId,
    first.request,
    sender,
    attachments,
    () => {
      if (!turnId) return dependencies.randomId()
      const result = turnId
      turnId = ''
      return result
    },
    dependencies.readAutomaticTitleWorkspace,
  )
  return accepted.message
}
