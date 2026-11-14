import type { Workspace } from '../../shared/generated/Workspace'
import { waitingEmail } from '../../../docs/mockups/src/fixtures/waitlist'
import type { AgentLoginStatus } from '../../shared/account'
import type { User } from '../../shared/api'
import type { OrgSummary } from '../../shared/orgs'
import type { RoutineRun } from '../../shared/routines'
import { fakeGitHubSummary } from '../../test-support/fake-api'
import {
  coreFixtures,
  FAKE_IDS,
  FAKE_TIME,
} from '../../test-support/fixtures/core'
import { listRuns } from '../../test-support/fixtures/routine-runs'
import { routineFixtures } from '../../test-support/fixtures/routines'
import {
  sampleOperator,
  sampleRecords,
  type OperatorRecords,
} from '../../test-support/fixtures/operator'
import {
  SAMPLE_IDS,
  sampleUsers,
} from '../../test-support/fixtures/operator-samples'
import { waitingUser } from '../../test-support/fixtures/waitlist'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { AGENTS } from '../api/read-core'
import { getStartedOrder } from '../get-started'
import { addReferralCode, referralCodeOf } from './access-codes'
import { devEndpointLogins } from './endpoint-logins'
import type { DevOptions } from './options'
import {
  freshOrg,
  type DevState,
  type DevWaitlist,
  type OrgState,
  type StartRecord,
} from './state'

type CoreFixtures = ReturnType<typeof coreFixtures>

const MINUTE = 60_000

/**
 * The waitlist of `waitlist=off`: the operator of the samples turned it off
 * 90 minutes ago. Zed K, who waited, came back half an hour later, so open
 * sign-up gave them app access with a new referral code, as the gate of the
 * Worker does. The other people still wait until their next visit.
 */
function turnOffWaitlist(records: OperatorRecords): void {
  records.waitlistSwitch = {
    waitlistOn: false,
    updatedAt: FAKE_TIME - 90 * MINUTE,
    operator: sampleOperator,
  }
  const zed = sampleUsers.find(
    (item) => item.githubId === SAMPLE_IDS.newestWaiting,
  )
  if (!zed) throw new Error('The operator samples have no Zed K.')
  const grantedAt = FAKE_TIME - 60 * MINUTE
  records.openSignups.set(zed.githubId, {
    grantedAt,
    operator: sampleOperator,
  })
  addReferralCode(
    records,
    { githubId: zed.githubId, login: zed.login },
    grantedAt,
  )
}

/** A deleted org stays for 7 days. */
const DELETE_AFTER = 604_800_000

/** The run that `run=` makes the run of `checkout-autocomplete`. */
const runOfWorkspace = {
  'pull-request': 'run-review-prs-opened-482',
  schedule: 'run-error-triage-hourly-3',
} as const

/**
 * The runs of the routines. Review pull requests can list the failed or
 * the skipped runs of the mockups in place of its newest runs. After the
 * suspension of Acme, it lists its runs as the suspension left them. One
 * run can have `checkout-autocomplete` as its workspace, which has a chat.
 */
function seedRuns(
  fixtures: ReturnType<typeof routineFixtures>,
  options: DevOptions,
): RoutineRun[] {
  const list = options.reviewRuns ?? (options.suspended ? 'suspended' : null)
  const review = fixtures.routines.find((item) => item.id === 'review-prs')
  const runs =
    list === null || !review
      ? fixtures.runs
      : [
          ...listRuns(review, list),
          ...fixtures.runs.filter((run) => run.routineId !== review.id),
        ]
  const linked = options.runWorkspace && runOfWorkspace[options.runWorkspace]
  return runs.map((run) =>
    run.id === linked ? { ...run, workspaceId: FAKE_IDS.workspace } : run,
  )
}

/**
 * Acme with the recorded sections, workspaces, settings, build, members,
 * and routines with their runs. A starting workspace has the recorded
 * resume step, and a workspace in the error state has the recorded start
 * error. `checkout-autocomplete` has the GitHub state of its recorded bar,
 * as the fake API gives it.
 */
function acme(
  summary: OrgSummary,
  core: CoreFixtures,
  options: DevOptions,
): OrgState {
  const { workspaces } = workspaceFixtures(
    options.server.workspaceState,
    fakeGitHubSummary(options.server),
  )
  const active = workspaces.workspaces.find(
    (workspace) => workspace.id === 'email-dark-mode',
  )
  if (active) active.state = 'working'
  const fixtures = routineFixtures(summary.id)
  const starting = workspaceFixtures('starting').detail.start
  const failed = workspaceFixtures('error').detail.error
  const startOf = (workspace: Workspace): [string, StartRecord] => [
    workspace.id,
    {
      start: workspace.state === 'starting' ? starting : null,
      error: workspace.state === 'error' ? failed : null,
    },
  ]
  const deletion = {
    deletedAt: FAKE_TIME,
    deletesAt: FAKE_TIME + DELETE_AFTER,
  }
  return {
    org: {
      ...summary,
      ...(options.deleted ? { deletion } : {}),
      ...(options.suspended ? { suspension: { suspendedAt: FAKE_TIME } } : {}),
    },
    sections: core.sectionList.sections,
    workspaces: workspaces.workspaces,
    workspaceNumberCount: Math.max(
      0,
      ...workspaces.workspaces.map(({ number }) => number),
    ),
    starts: new Map(workspaces.workspaces.map(startOf)),
    created: new Set(),
    running: new Map(),
    repositories: core.repositories.repositories,
    settings: core.settings.settings,
    builds: [core.build],
    settingsRevision: 1,
    buildInputs: new Map([
      [
        core.build.build.id,
        {
          installScript: core.settings.settings.installScript,
          repositories: core.repositories.repositories
            .filter((repository) => repository.selected)
            .map(({ id, fullName }) => ({ id, fullName })),
        },
      ],
    ]),
    currentImageBuildId: core.builds.currentImageBuildId,
    members: core.members,
    routines: fixtures.routines,
    runs: seedRuns(fixtures, options),
  }
}

/**
 * The records of the operator samples. Acme of the options is deleted or
 * suspended there too, so the operator sees it as its members do. The
 * pause and the switch of the options, and the state of the referral code
 * of `user`, are those that the waitlist routes read too.
 */
function operatorRecords(options: DevOptions, user: User): OperatorRecords {
  const records = sampleRecords(FAKE_TIME)
  if (options.deleted) {
    records.orgDeletions.set(FAKE_IDS.org, {
      deletedAt: FAKE_TIME,
      purgeAt: FAKE_TIME + DELETE_AFTER,
    })
  }
  if (options.suspended) {
    records.orgSuspensions.set(FAKE_IDS.org, {
      suspendedAt: FAKE_TIME,
      operator: sampleOperator,
    })
  }
  if (options.paused) {
    records.pause = {
      paused: true,
      updatedAt: FAKE_TIME,
      operator: sampleOperator,
    }
  }
  if (options.waitlistOff) turnOffWaitlist(records)
  const own = referralCodeOf(records, user.githubId)
  if (own && options.inviteCode === 'used-up') own.uses = own.useLimit
  if (own && options.inviteCode === 'disabled') {
    own.disabledAt = FAKE_TIME
    own.disabledBy = sampleOperator
  }
  return records
}

/**
 * The invitation of Acme that waits for Sam, and Acme as Sam joins it: as a
 * member, beside the people of Acme.
 */
function acmeInvitation(
  core: CoreFixtures,
  options: DevOptions,
): DevWaitlist['invitations'][number] {
  const summary: OrgSummary = {
    ...(core.orgs.orgs.find((org) => org.id === FAKE_IDS.org) ??
      core.orgs.orgs[0]),
    role: 'member',
  }
  const org = acme(summary, core, options)
  org.members = {
    ...org.members,
    members: [
      ...org.members.members,
      { user: waitingUser, role: 'member', joinedAt: FAKE_TIME },
    ],
  }
  return {
    invite: {
      id: 'invite-acme',
      email: waitingEmail,
      createdAt: FAKE_TIME - 3_600_000,
      orgId: summary.id,
      orgName: summary.name,
    },
    org,
  }
}

/**
 * The state when the app opens. Get started is done before `firstRun`, and
 * not done from it on. The other recorded orgs start as new orgs, because
 * the recorded server has no replies for them. With `waiting`, the user is
 * Sam, who waits for app access.
 */
export function seedState(options: DevOptions): DevState {
  const core = coreFixtures(options.server.role)
  const waits = options.waiting !== null
  const user = waits ? waitingUser : core.account.user
  const { firstRun } = options
  const noOrg = firstRun === 'github-app' || firstRun === 'org'
  const noLogin = options.noAgentLogin || firstRun !== null
  const done =
    firstRun === null
      ? getStartedOrder.length
      : getStartedOrder.indexOf(firstRun)
  const orgs = core.orgs.orgs.map((org) =>
    org.id === FAKE_IDS.org
      ? acme(org, core, options)
      : freshOrg(org, user, FAKE_TIME),
  )
  return {
    account: {
      ...core.account,
      user,
      operator: options.operator,
      agentLogins: noLogin
        ? AGENTS.map((agent): AgentLoginStatus => ({ agent, connected: false }))
        : options.endpointLogins
          ? devEndpointLogins(options.modelList)
          : core.account.agentLogins,
    },
    getStarted: {
      orgId: noOrg ? null : FAKE_IDS.org,
      steps: getStartedOrder.map((step, index) => ({
        step,
        complete: index < done,
      })),
    },
    orgs: noOrg ? [] : orgs,
    githubAppInstalled: firstRun !== 'github-app',
    attachments: new Map(),
    stopAfterMs: options.stopAfterMs,
    operator: operatorRecords(options, user),
    shareSaveFails: options.shareSaveFails,
    waitlist: {
      appAccess: !waits,
      approvalEmail:
        waits && options.waiting === 'verified' ? waitingEmail : null,
      invitations:
        waits && options.invited ? [acmeInvitation(core, options)] : [],
    },
  }
}
