import type { Workspace } from '../../shared/generated/Workspace'
import { orgPath, type OrgRole, type User } from '../../shared/api'
import { routes } from '../../app/router'
import {
  memberPath,
  membersPath,
  type MembersResponse,
} from '../../shared/members'
import { orgSettingsPaths } from '../../shared/org-settings'
import { deleteOrgPath, restoreOrgPath } from '../../shared/orgs'
import { workspacesPath } from '../../shared/workspaces'
import type { FakeRouteWriter } from '../../test-support/fake-api-routes'
import {
  coreFixtures,
  FAKE_TIME,
  FAKE_ORIGIN,
  fakeUsers,
} from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { deletionTime } from '../time'
import { computerReplies, type ComputerScene } from './devComputer'

/**
 * The orgs of the dev page: Acme, as the fake API serves it, and Futex,
 * which the dev page adds with other members, so that a change of org
 * shows whether old data stays.
 */
export const devOrgIds = ['acme', 'futex'] as const
export type DevOrgId = (typeof devOrgIds)[number]

const ana: User = {
  id: 'ana',
  githubId: 4,
  githubLogin: 'analima',
  displayName: 'Ana Lima',
  avatarUrl: null,
}

/** The members of an org. Futex shares Cal and Priya with Acme, and adds Ana. */
export function devMembers(org: DevOrgId): MembersResponse {
  const acme = coreFixtures().members
  if (org === 'acme') return acme
  return {
    members: [
      ...acme.members.filter((member) => member.user.id !== 'jonas'),
      { user: ana, role: 'member', joinedAt: FAKE_TIME - 86_400_000 },
    ],
    invites: [],
  }
}

/** The workspace that the header of the dev page shows for an org. */
export function devWorkspace(org: DevOrgId): Workspace {
  const checkout = workspaceFixtures().detail.workspace
  if (org === 'acme') return checkout
  const priya = fakeUsers.find((user) => user.id === 'priya') ?? checkout.owner
  return {
    ...checkout,
    id: 'rail-drag',
    orgId: 'futex',
    number: 1,
    link: new URL(routes.workspace('futex', 'rail-drag'), FAKE_ORIGIN).href,
    name: 'Rail drag and drop',
    branch: 'priyaraman/rail-drag',
    owner: priya,
  }
}

/** The replies of Futex, which the fake API of Milestone 4a does not have. */
export function addFutexRoutes(
  server: FakeRouteWriter,
  role: OrgRole,
  scene: ComputerScene,
) {
  const org = 'futex'
  const data = coreFixtures(role)
  server.json('GET', membersPath(org), devMembers(org))
  server.json('GET', workspacesPath(org), { workspaces: [devWorkspace(org)] })
  server.json('GET', orgSettingsPaths.repositories(org), data.repositories)
  server.json('GET', orgSettingsPaths.settings(org), data.settings)
  for (const reply of computerReplies(scene, org)) {
    server.json('GET', reply.path, reply.body)
  }
  for (const member of devMembers(org).members) {
    server.json('PATCH', memberPath(org, member.user.id), { member })
    server.empty('DELETE', memberPath(org, member.user.id))
  }
  const summary = data.orgs.orgs.find((item) => item.id === org)
  if (!summary) return
  const deletion = { deletedAt: FAKE_TIME, deletesAt: deletionTime(FAKE_TIME) }
  server.json('GET', orgPath(org), { org: summary })
  server.json('POST', deleteOrgPath(org), { org: { ...summary, deletion } })
  server.json('POST', restoreOrgPath(org), { org: summary })
}
