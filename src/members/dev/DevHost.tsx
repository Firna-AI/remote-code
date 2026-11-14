import type { Workspace } from '../../shared/generated/Workspace'
import { useEffect, useMemo, useRef, useState } from 'react'
import { nameLabel } from '../../shared/name-label'
import type { OrgSummary } from '../../shared/orgs'

import { coreFixtures, FAKE_TIME } from '../../test-support/fixtures/core'
import { createMembersApi, type MembersApi } from '../api/client'
import { DeletedOrgPage } from '../DeletedOrgPage'
import { DeleteOrgSection } from '../DeleteOrgSection'
import { MemberComputerTab } from '../MemberComputerTab'
import { MemberRepositoriesTab } from '../MemberRepositoriesTab'
import { MembersTab } from '../MembersTab'
import { OwnerPicker } from '../OwnerPicker'
import { deletionTime } from '../time'
import { computerBuilds } from './devComputer'
import {
  DevMainFrame,
  DevNote,
  DevSettingsFrame,
  DevWorkspaceFrame,
} from './DevFrame'
import { DevLiveComputer } from './DevLiveComputer'
import { DevMenuLab } from './DevMenuLab'
import { useDevOptions, type DevOptions } from './devOptions'
import { devWorkspace, type DevOrgId } from './devOrgs'
import { createDevFetch } from './devServer'

function SettingsBody(props: {
  api: MembersApi
  options: DevOptions
  org: OrgSummary
  viewerId: string
  onDeleted: (org: OrgSummary) => void
}) {
  const { api, options, org } = props
  const member = org.role === 'member'
  switch (options.view) {
    case 'general':
      return member ? (
        <DevNote>Milestone 6 builds the read-only name of the org.</DevNote>
      ) : (
        <DeleteOrgSection
          api={api}
          now={FAKE_TIME}
          onDeleted={props.onDeleted}
          org={org}
          viewport={options.viewport}
        />
      )
    case 'repositories':
      return member ? (
        <MemberRepositoriesTab
          api={api}
          builds={computerBuilds(options.computer)}
          org={org}
          viewport={options.viewport}
        />
      ) : (
        <DevNote>Milestone 6 builds the Repositories tab of an admin.</DevNote>
      )
    case 'computer':
      if (!member) {
        return (
          <DevNote>
            Milestone 6 builds the Cloud computer tab of an admin.
          </DevNote>
        )
      }
      return options.computer === 'live' ? (
        <DevLiveComputer org={org} viewport={options.viewport} />
      ) : (
        <MemberComputerTab
          api={api}
          now={FAKE_TIME}
          org={org}
          viewport={options.viewport}
        />
      )
    default:
      return (
        <MembersTab
          api={api}
          now={FAKE_TIME}
          org={org}
          viewerId={props.viewerId}
          viewport={options.viewport}
        />
      )
  }
}

/**
 * The workspace of the header. Like a simple shell, the header shows the
 * workspace that the picker reported last, for the org that shows now.
 */
function useHeaderWorkspace(org: DevOrgId) {
  const current = useRef(org)
  useEffect(() => {
    current.current = org
  })
  const [reported, setReported] = useState<{
    org: DevOrgId
    workspace: Workspace
  } | null>(null)
  return {
    workspace: reported?.org === org ? reported.workspace : devWorkspace(org),
    report: (workspace: Workspace) =>
      setReported({ org: current.current, workspace }),
  }
}

/**
 * The dev page of the members UI, against the fake API. It draws each part
 * in a stand-in of the app shell, with its scope in the address, so Back and
 * Forward give the mounted parts new props. It follows each callback as the
 * shell does: a deleted org shows its restore page, as its address does in
 * the shell, and a new owner shows in the header.
 */
export function DevHost() {
  const [options, navigate] = useDevOptions()
  const { role, failure, once, delay, slow, computer, people } = options
  const api = useMemo(
    () =>
      createMembersApi(
        createDevFetch({
          role,
          failure,
          once,
          delay,
          slow,
          computer,
          people,
        }),
      ),
    [role, failure, once, delay, slow, computer, people],
  )
  const fixtures = coreFixtures(role)
  const active =
    fixtures.orgs.orgs.find((item) => item.id === options.org) ??
    fixtures.orgs.orgs[0]
  const [deletions, setDeletions] = useState<
    Readonly<Record<string, OrgSummary['deletion']>>
  >({})
  const header = useHeaderWorkspace(options.org)
  const deletion = deletions[active.id] ?? {
    deletedAt: FAKE_TIME,
    deletesAt: deletionTime(FAKE_TIME),
  }

  if (options.view === 'deleted') {
    return (
      <DevMainFrame options={options}>
        <DeletedOrgPage
          api={api}
          onRestored={() => navigate({ view: 'general' })}
          org={{ ...active, deletion }}
          viewport={options.viewport}
        />
      </DevMainFrame>
    )
  }
  if (options.view === 'menu-lab') {
    return <DevMenuLab api={api} options={options} />
  }
  if (options.view === 'workspace') {
    return (
      <DevWorkspaceFrame
        branch={header.workspace.branch}
        name={nameLabel(header.workspace.name)}
        options={options}
        owner={
          <OwnerPicker
            api={api}
            canReassign={role === 'admin'}
            onReassigned={header.report}
            viewport={options.viewport}
            workspace={header.workspace}
          />
        }
      />
    )
  }
  return (
    <DevSettingsFrame options={options} orgName={active.name}>
      <SettingsBody
        api={api}
        onDeleted={(deleted) => {
          setDeletions((all) => ({ ...all, [deleted.id]: deleted.deletion }))
          navigate({ view: 'deleted' })
        }}
        options={options}
        org={active}
        viewerId={fixtures.account.user.id}
      />
    </DevSettingsFrame>
  )
}
