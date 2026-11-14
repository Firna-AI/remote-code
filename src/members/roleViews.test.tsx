import type { Workspace } from '../shared/generated/Workspace'
import { routes } from '../app/router'
import { FAKE_ORIGIN } from '../test-support/fixtures/core'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { User } from '../shared/api'
import type { OrgInvite, OrgMember } from '../shared/members'
import type { OrgSummary } from '../shared/orgs'

import { FakeApiServer } from '../test-support/fake-api'
import { createMembersApi } from './api/client'
import { DeletedOrgPage } from './DeletedOrgPage'
import { DeleteOrgSection } from './DeleteOrgSection'
import { check } from './markupCheck'
import { MemberList, type MemberListProps } from './MemberList'
import { OwnerPicker } from './OwnerPicker'
import { RemoveMemberDialog } from './RemoveMemberDialog'

const api = createMembersApi(new FakeApiServer().fetch)
const nothing = () => undefined

function person(id: string, login: string, name: string): User {
  return {
    id,
    githubId: 1,
    githubLogin: login,
    displayName: name,
    avatarUrl: null,
  }
}
const cal = person('cal', 'calummoore', 'Cal')
const priya = person('priya', 'priyaraman', 'Priya Raman')
const jonas = person('jonas', 'jonasweber', 'Jonas Weber')
const members: OrgMember[] = [
  { user: cal, role: 'admin', joinedAt: 0 },
  { user: priya, role: 'member', joinedAt: 0 },
  { user: jonas, role: 'member', joinedAt: 0 },
]
const invites: OrgInvite[] = [
  { id: 'invite-1', email: 'mira@example.com', createdAt: 0 },
]
const acme: OrgSummary = { id: 'acme', name: 'Acme', role: 'admin' }
const deletedAcme: OrgSummary = {
  ...acme,
  deletion: {
    deletedAt: Date.UTC(2026, 10, 5, 12),
    deletesAt: Date.UTC(2026, 10, 12, 12),
  },
}
const workspace: Workspace = {
  github: null,
  id: 'checkout',
  number: 1,
  link: new URL(routes.workspace('acme', 'checkout'), FAKE_ORIGIN).href,
  orgId: 'acme',
  repositoryId: 'storefront',
  sectionId: 'general',
  owner: cal,
  name: 'Checkout address autocomplete',
  branch: 'calummoore/checkout',
  choice: { agent: 'claude', model: 'Opus 5.5', effort: 'high', fast: false },
  state: 'ready',
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  restoreUntil: null,
}

function list(props: Partial<MemberListProps>): ReactElement {
  return (
    <MemberList
      canManage
      invites={invites}
      members={members}
      now={0}
      onCancelInvite={nothing}
      onChangeRole={nothing}
      onRemove={nothing}
      owned={{ cal: 6, priya: 2, jonas: 1 }}
      pending={[]}
      viewerId="cal"
      {...props}
    />
  )
}

const adminActions = [
  'aria-haspopup',
  'Remove',
  'Restore',
  'Delete org',
  'mira@example.com',
]

describe('the views of a member who is not an admin', () => {
  it('show_names_roles_and_owners_without_admin_actions', () => {
    const cases: { name: string; element: ReactElement; present: string[] }[] =
      [
        {
          name: 'members',
          element: list({ canManage: false, viewerId: 'priya' }),
          present: [
            'Cal',
            'Admin',
            'Priya Raman (you)',
            '@jonasweber · 1 workspace',
          ],
        },
        {
          name: 'owner',
          element: (
            <OwnerPicker
              api={api}
              canReassign={false}
              onReassigned={nothing}
              viewport="desktop"
              workspace={workspace}
            />
          ),
          present: ['Cal', 'owner of the workspace'],
        },
        {
          name: 'delete org',
          element: (
            <DeleteOrgSection
              api={api}
              now={0}
              onDeleted={nothing}
              org={{ ...acme, role: 'member' }}
              viewport="desktop"
            />
          ),
          present: [],
        },
        {
          name: 'restore page',
          element: (
            <DeletedOrgPage
              api={api}
              onRestored={nothing}
              org={{ ...deletedAcme, role: 'member' }}
              timeZone="UTC"
              viewport="desktop"
            />
          ),
          present: ['Acme is deleted on 12 November'],
        },
      ]
    for (const item of cases) {
      expect({
        case: item.name,
        ...check(item.element, item.present, adminActions),
      }).toEqual({
        case: item.name,
        missing: [],
        unwanted: [],
      })
    }
  })
})

describe('the views of an admin', () => {
  it('offer_the_role_menu_and_remove_for_other_members_but_not_for_the_admin', () => {
    expect(
      check(
        list({}),
        [
          'aria-label="Role of Priya Raman: Member"',
          'aria-label="Role of Jonas Weber: Member"',
          'aria-label="Remove Priya Raman"',
          'aria-label="Remove Jonas Weber"',
          'aria-label="Cancel the invite to mira@example.com"',
        ],
        ['Role of Cal', 'Remove Cal'],
      ),
    ).toEqual({ missing: [], unwanted: [] })
  })

  it('say_where_the_workspaces_of_a_removed_member_go', () => {
    const cases = [
      {
        owned: 2,
        says: "Priya can no longer open Acme. Priya's 2 workspaces move to you.",
      },
      {
        owned: 1,
        says: "Priya can no longer open Acme. Priya's workspace moves to you.",
      },
    ]
    for (const item of cases) {
      const dialog = (
        <RemoveMemberDialog
          busy={false}
          error={null}
          member={members[1]}
          onCancel={nothing}
          onConfirm={nothing}
          orgName="Acme"
          owned={item.owned}
        />
      )
      expect({ owned: item.owned, ...check(dialog, [item.says], []) }).toEqual({
        owned: item.owned,
        missing: [],
        unwanted: [],
      })
    }
  })
})
