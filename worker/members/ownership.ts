import type { MessageSender } from '../../src/shared/generated/MessageSender'
import { HttpError } from '../http'
import { userSuspended } from '../data/user-access'
import { suspendedOwnerRecipientError } from './errors'
import { guardedMembersWrite } from './guarded-write'
import { requireMember } from './membership'
import { updateWorkspaceOwner } from './ownership-data'
import { requireOrgAdmin, requireOrgMember } from './permissions'
import type { MembersHooks } from './route'

/** The workspace lifecycle stores this member's ID in owner_user_id at creation. */
export async function workspaceCreator(
  db: D1Database,
  orgId: string,
  userId: string,
): Promise<MessageSender> {
  await requireOrgMember(db, orgId, userId)
  const { user } = await requireMember(db, orgId, userId)
  return {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }
}

export async function reassignWorkspace(
  db: D1Database,
  orgId: string,
  actorId: string,
  workspaceId: string,
  userId: string,
  now: number,
  hooks: Pick<MembersHooks, 'readWorkspace' | 'workspaceOwnerChanged'>,
) {
  await guardedMembersWrite({
    checks: [
      () => requireOrgAdmin(db, orgId, actorId),
      () => requireOwnerRecipient(db, orgId, userId),
    ],
    write: () =>
      updateWorkspaceOwner(db, orgId, actorId, workspaceId, userId, now),
    refusal: () =>
      new HttpError(
        404,
        'workspace_not_found',
        'The workspace is not available.',
      ),
  })
  await hooks.workspaceOwnerChanged(workspaceId)
  return hooks.readWorkspace(orgId, workspaceId, actorId)
}

async function requireOwnerRecipient(
  db: D1Database,
  orgId: string,
  userId: string,
) {
  await requireMember(db, orgId, userId)
  if (await userSuspended(db, userId)) throw suspendedOwnerRecipientError()
}
