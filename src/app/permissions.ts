import type { Workspace } from '../shared/generated/Workspace'
import type { OrgRole, User } from '../shared/api'
import type { OrgSummary } from '../shared/orgs'

import type { Readable } from './store'

/**
 * Whether the operator suspended an org: its summary says so, or the API
 * refused one of its requests with `org_suspended` while the summary was
 * old. `refused` holds the IDs of the orgs of such refusals.
 */
export function isSuspended(
  org: Pick<OrgSummary, 'id' | 'suspension'>,
  refused: ReadonlySet<string>,
): boolean {
  return org.suspension !== undefined || refused.has(org.id)
}

/**
 * Whether an org is suspended, from its summary in `orgs` or from a
 * refusal of the API in `refused`, as a value to follow.
 */
export function suspendedOrg(
  orgId: string,
  orgs: Readable<readonly OrgSummary[]>,
  refused: Readable<ReadonlySet<string>>,
): Readable<boolean> {
  return {
    get: () => {
      const org = orgs.get().find((item) => item.id === orgId)
      return org !== undefined && isSuspended(org, refused.get())
    },
    subscribe: (listener) => {
      const stops = [orgs.subscribe(listener), refused.subscribe(listener)]
      return () => {
        for (const stop of stops) stop()
      }
    },
  }
}

/**
 * What the person signed in may do in an org: their role, and whether the
 * org is suspended. Nothing in a suspended org can change, except a leave.
 */
export interface OrgAccess {
  role: OrgRole
  suspended: boolean
}

/**
 * Only an admin changes the shared settings of an org: its name, its
 * repositories, its scripts, and its env vars. Nothing in a suspended org
 * changes, also for an admin.
 */
export function mayChangeSettings(access: OrgAccess): boolean {
  return access.role === 'admin' && !access.suspended
}

/**
 * Only the owner of a workspace and the admins of its org archive it
 * (decision 42). An archived workspace has nothing more to archive, and a
 * suspended org archives nothing.
 */
export function mayArchive(
  access: OrgAccess,
  workspace: Workspace,
  viewer: Pick<User, 'id'>,
): boolean {
  if (workspace.state === 'archived' || access.suspended) return false
  return access.role === 'admin' || workspace.owner.id === viewer.id
}

/**
 * Every member of an org that is not suspended restores an archived
 * workspace while the app keeps its cloud computer, until `restoreUntil`.
 * Restore deletes nothing, so the role and the owner do not count. `ended`
 * says that the clock of the page reached `restoreUntil`.
 */
export function mayRestore(
  access: Pick<OrgAccess, 'suspended'>,
  workspace: Pick<Workspace, 'state' | 'restoreUntil'>,
  ended: boolean,
): boolean {
  return (
    workspace.state === 'archived' &&
    workspace.restoreUntil !== null &&
    !ended &&
    !access.suspended
  )
}
