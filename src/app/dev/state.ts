import type { Workspace } from '../../shared/generated/Workspace'
import type { Attachment } from '../../shared/generated/Attachment'
import type { AccountResponse } from '../../shared/account'
import type { User } from '../../shared/api'
import { BASE_IMAGE } from '../../shared/base-image'
import type { MembersResponse, PendingOrgInvite } from '../../shared/members'
import type {
  GetStartedResponse,
  GetStartedStep,
} from '../../shared/onboarding'
import type {
  BuildResponse,
  OrgSettings,
  Repository,
} from '../../shared/org-settings'
import type { OrgSummary } from '../../shared/orgs'
import type { Routine, RoutineRun } from '../../shared/routines'
import type { Section } from '../../shared/sections'
import type { WorkspaceResponse } from '../../shared/workspaces'
import { coreFixtures } from '../../test-support/fixtures/core'
import type { OperatorRecords } from '../../test-support/fixtures/operator'

/** The start steps and the start error of one workspace. */
export type StartRecord = Pick<WorkspaceResponse, 'start' | 'error'>

/** One org of the user, as the dev fake keeps it in memory. */
export interface OrgState {
  org: OrgSummary
  /** In the order of their positions, which count from 0. */
  sections: readonly Section[]
  /** In the order of the workspace list. */
  workspaces: readonly Workspace[]
  workspaceNumberCount: number
  starts: Map<string, StartRecord>
  /** The workspaces that the fake made. The recorded server has no replies for them. */
  created: Set<string>
  /** The cancel of each start that runs, by workspace ID. */
  running: Map<string, () => void>
  repositories: readonly Repository[]
  settings: OrgSettings
  settingsRevision: number
  buildInputs: Map<
    string,
    {
      installScript: string
      repositories: readonly Pick<Repository, 'id' | 'fullName'>[]
    }
  >
  /** Each build with its log, the newest first. */
  builds: readonly BuildResponse[]
  currentImageBuildId: string | null
  members: MembersResponse
  /** Newest first, as the Worker lists them. */
  routines: readonly Routine[]
  /** The runs of every routine of the org. */
  runs: readonly RoutineRun[]
}

/**
 * The waitlist of the person signed in: their app access, the address of
 * their approval email, and the org invitations that wait for them. The
 * pause and the codes, with the referral code of the person, are those of
 * the operator section, in `DevState.operator`.
 */
export interface DevWaitlist {
  appAccess: boolean
  /** The primary verified email of the user, or `null`. */
  approvalEmail: string | null
  /** Each invitation, with the state of the org that an Accept joins. */
  invitations: { invite: PendingOrgInvite; org: OrgState }[]
}

/** Everything that the writes of the dev fake change. */
export interface DevState {
  account: AccountResponse
  getStarted: GetStartedResponse
  /** In the order of the org rail. */
  orgs: readonly OrgState[]
  /** `false` until the user installs the GitHub App. */
  githubAppInstalled: boolean
  /** The file uploads of the fake, by ID, which a create or a send names. */
  attachments: Map<string, Attachment>
  /** The wait before an open workspace stops, from `stop=<seconds>`. */
  stopAfterMs: number | null
  /**
   * The suspensions and deletions of the sample orgs and users of the
   * operator section, which Suspend and Lift change, and the records of
   * the waitlist: the approvals, the codes, and the pause. The operator
   * section and the waitlist of the person signed in share them, as they
   * share the database of the Worker.
   */
  operator: OperatorRecords
  /** Each change of a share setting fails, from `shareSave=fail`. */
  shareSaveFails: boolean
  waitlist: DevWaitlist
}

/**
 * The repositories of a new org: every repository of the account catalogue,
 * which the person and the GitHub App both reach, with the chosen GitHub
 * IDs added.
 */
function catalogueOf(
  orgId: string,
  chosen: readonly number[],
): readonly Repository[] {
  const taken: string[] = []
  return coreFixtures().githubRepositories.repositories.map((repository) => {
    const id = uniqueId(repository.fullName.split('/').at(-1) ?? 'repo', taken)
    taken.push(id)
    return {
      ...repository,
      id,
      orgId,
      selected: chosen.includes(repository.githubId),
    }
  })
}

/**
 * A new org: the default section, no workspaces, the repositories of the
 * catalogue with the chosen ones added, empty scripts with the base image,
 * no builds, the user as its only member, and no routines.
 */
export function freshOrg(
  org: OrgSummary,
  user: User,
  now: number,
  chosen: readonly number[] = [],
): OrgState {
  const { sectionList } = coreFixtures()
  const general =
    sectionList.sections.find((section) => section.isDefault) ??
    sectionList.sections[0]
  return {
    org,
    sections: [{ ...general, orgId: org.id, position: 0, collapsed: false }],
    workspaces: [],
    workspaceNumberCount: 0,
    starts: new Map(),
    created: new Set(),
    running: new Map(),
    repositories: catalogueOf(org.id, chosen),
    settings: {
      baseImage: BASE_IMAGE,
      installScript: '',
      startupScript: '',
      envVars: [],
      updatedAt: now,
    },
    builds: [],
    settingsRevision: 1,
    buildInputs: new Map(),
    currentImageBuildId: null,
    members: {
      members: [{ user, role: org.role, joinedAt: now }],
      invites: [],
    },
    routines: [],
    runs: [],
  }
}

/** Marks a step of Get started as done. */
export function completeStep(state: DevState, step: GetStartedStep): void {
  state.getStarted = {
    ...state.getStarted,
    steps: state.getStarted.steps.map((item) =>
      item.step === step ? { step, complete: true } : item,
    ),
  }
}

/** A readable ID from a name, such as `acme-labs` for "Acme Labs". */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? fallback : slug
}

/** `base`, or `base-2`, `base-3`, and so on when another item has the ID. */
export function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  let number = 2
  while (taken.includes(`${base}-${number}`)) number += 1
  return `${base}-${number}`
}
