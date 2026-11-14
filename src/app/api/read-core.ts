import type { AgentModel } from '../../shared/generated/AgentModel'
import type { Agent } from '../../shared/generated/Agent'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { Effort } from '../../shared/generated/Effort'
import type { MessageSender } from '../../shared/generated/MessageSender'
import {
  NEW_WORKSPACE_VIEWS,
  type AccountResponse,
  type AgentLoginStatus,
  type GitHubInstallation,
  type GitHubInstallationsResponse,
  type GitHubRepositoriesResponse,
  type GitHubRepository,
  type PollCodexDeviceResponse,
  type SetNewWorkspaceViewResponse,
  type StartCodexDeviceResponse,
} from '../../shared/account'

import type { OrgRole, User } from '../../shared/api'
import type { GetStartedResponse } from '../../shared/onboarding'
import type { OrgSummary } from '../../shared/orgs'
import type { Section } from '../../shared/sections'
import { getStartedOrder } from '../get-started'
import {
  choice,
  count,
  flag,
  items,
  maybeNested,
  maybeText,
  nested,
  record,
  text,
  texts,
} from './parse'
import { readShortcuts } from './read-shortcuts'

export const AGENTS = ['claude', 'codex'] as const satisfies readonly Agent[]
export const EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const satisfies readonly Effort[]
export const ROLES = ['admin', 'member'] as const satisfies readonly OrgRole[]

export function readUser(value: unknown): User {
  const user = record(value, 'user')
  return {
    id: text(user, 'id'),
    githubId: count(user, 'githubId'),
    githubLogin: text(user, 'githubLogin'),
    displayName: maybeText(user, 'displayName'),
    avatarUrl: maybeText(user, 'avatarUrl'),
  }
}

export function readSender(value: unknown): MessageSender {
  const sender = record(value, 'sender')
  return {
    id: text(sender, 'id'),
    githubLogin: text(sender, 'githubLogin'),
    displayName: maybeText(sender, 'displayName'),
    avatarUrl: maybeText(sender, 'avatarUrl'),
  }
}

export function readOrg(value: unknown): OrgSummary {
  const org = record(value, 'org')
  const deletion = maybeNested(org, 'deletion', (item) => {
    const fields = record(item, 'deletion')
    return {
      deletedAt: count(fields, 'deletedAt'),
      deletesAt: count(fields, 'deletesAt'),
    }
  })
  const suspension = maybeNested(org, 'suspension', (item) => ({
    suspendedAt: count(record(item, 'suspension'), 'suspendedAt'),
  }))
  const initials = maybeText(org, 'initials')
  return {
    id: text(org, 'id'),
    name: text(org, 'name'),
    role: choice(org, 'role', ROLES),
    ...(initials === null ? {} : { initials }),
    ...(suspension === null ? {} : { suspension }),
    ...(deletion === null ? {} : { deletion }),
  }
}

export function readSection(value: unknown): Section {
  const section = record(value, 'section')
  return {
    id: text(section, 'id'),
    orgId: text(section, 'orgId'),
    name: text(section, 'name'),
    position: count(section, 'position'),
    isDefault: flag(section, 'isDefault'),
    collapsed: flag(section, 'collapsed'),
  }
}

export function readChoice(value: unknown): AgentChoice {
  const fields = record(value, 'choice')
  return {
    agent: choice(fields, 'agent', AGENTS),
    model: text(fields, 'model'),
    effort: choice(fields, 'effort', EFFORTS),
    fast: fields.fast === true,
  }
}

export function readModel(value: unknown): AgentModel {
  const model = record(value, 'model')
  return {
    agent: choice(model, 'agent', AGENTS),
    model: text(model, 'model'),
    label: text(model, 'label'),
    ...(typeof model.fast === 'boolean' && { fast: model.fast }),
    efforts: items(model, 'efforts', (effort) =>
      choice({ effort }, 'effort', EFFORTS),
    ),
  }
}

export function readLogin(value: unknown): AgentLoginStatus {
  const login = record(value, 'agent login')
  const agent = choice(login, 'agent', AGENTS)
  if (!flag(login, 'connected')) return { agent, connected: false }
  const updatedAt = count(login, 'updatedAt')
  const noReuse = flag(login, 'noReuse')
  if (login.kind === 'endpoint') {
    return {
      agent,
      connected: true,
      kind: 'endpoint',
      host: text(login, 'host'),
      ...(login.modelList === undefined
        ? {}
        : {
            modelList: nested(login, 'modelList', (value) => {
              const list = record(value, 'endpoint model list')
              return {
                missing: texts(list, 'missing'),
                checkedAt: count(list, 'checkedAt'),
              }
            }),
          }),
      noReuse,
      updatedAt,
    }
  }
  return {
    agent,
    connected: true,
    kind: choice(login, 'kind', ['token', 'api-key']),
    noReuse,
    updatedAt,
    ...(agent === 'codex' && login.unusableCause !== undefined
      ? { unusableCause: text(login, 'unusableCause') }
      : {}),
  }
}

/**
 * What says whether turns can run on a login of the user. The full login
 * status has these fields, and so do the narrower summaries of screens.
 */
export interface LoginUse {
  connected: boolean
  unusableCause?: string
}

/**
 * Whether turns can run on a login of the user: it is connected, and the
 * Worker gives no cause that stops it, such as a ChatGPT sign-in that
 * OpenAI did not renew. A login that is missing cannot run turns.
 */
export function loginUsable(login: LoginUse | undefined): boolean {
  return login?.connected === true && login.unusableCause === undefined
}

/** The states of a ChatGPT sign-in of Codex, as a poll answers them. */
const CODEX_DEVICE_STATES = [
  'waiting',
  'connected',
  'expired',
  'failed',
] as const satisfies readonly PollCodexDeviceResponse['state'][]

/** A started ChatGPT sign-in: its handle, its code, and its times. */
export function readCodexDeviceStart(value: unknown): StartCodexDeviceResponse {
  const start = record(value, 'ChatGPT sign-in')
  return {
    handle: text(start, 'handle'),
    userCode: text(start, 'userCode'),
    verificationUrl: text(start, 'verificationUrl'),
    expiresAt: count(start, 'expiresAt'),
    pollIntervalMs: count(start, 'pollIntervalMs'),
  }
}

/** The state of a ChatGPT sign-in, with the connected login at the end. */
export function readCodexDevicePoll(value: unknown): PollCodexDeviceResponse {
  const poll = record(value, 'ChatGPT sign-in')
  const state = choice(poll, 'state', CODEX_DEVICE_STATES)
  switch (state) {
    case 'waiting':
      return { state, pollIntervalMs: count(poll, 'pollIntervalMs') }
    case 'connected':
      return { state, login: nested(poll, 'login', readLogin) }
    case 'expired':
      return { state }
    case 'failed':
      return { state, cause: text(poll, 'cause') }
  }
}

export function readAccount(value: unknown): AccountResponse {
  const account = record(value, 'account')
  return {
    user: nested(account, 'user', readUser),
    defaultChoice: nested(account, 'defaultChoice', readChoice),
    newWorkspaceView: choice(account, 'newWorkspaceView', NEW_WORKSPACE_VIEWS),
    shortcuts: nested(account, 'shortcuts', readShortcuts),
    agentLogins: items(account, 'agentLogins', readLogin),
    operator: flag(account, 'operator'),
    githubAppUrl: text(account, 'githubAppUrl'),
  }
}

export function readNewWorkspaceView(
  value: unknown,
): SetNewWorkspaceViewResponse {
  return { view: choice(record(value), 'view', NEW_WORKSPACE_VIEWS) }
}

function readInstallation(value: unknown): GitHubInstallation {
  const installation = record(value, 'installation')
  return {
    id: count(installation, 'id'),
    account: text(installation, 'account'),
    repositoryCount: count(installation, 'repositoryCount'),
    settingsUrl: text(installation, 'settingsUrl'),
  }
}

export function readInstallations(value: unknown): GitHubInstallationsResponse {
  const body = record(value, 'installations')
  return {
    installations: items(body, 'installations', readInstallation),
    installUrl: text(body, 'installUrl'),
  }
}

function readGitHubRepository(value: unknown): GitHubRepository {
  const repository = record(value, 'repository')
  return {
    githubId: count(repository, 'githubId'),
    fullName: text(repository, 'fullName'),
    description: text(repository, 'description'),
    defaultBranch: text(repository, 'defaultBranch'),
    installationId: count(repository, 'installationId'),
  }
}

/** The repositories that the person and the GitHub App both reach. */
export function readGitHubRepositories(
  value: unknown,
): GitHubRepositoriesResponse {
  const body = record(value, 'repositories')
  return { repositories: items(body, 'repositories', readGitHubRepository) }
}

export function readGetStarted(value: unknown): GetStartedResponse {
  const body = record(value, 'get started')
  return {
    orgId: maybeText(body, 'orgId'),
    steps: items(body, 'steps', (item) => {
      const step = record(item, 'step')
      return {
        step: choice(step, 'step', getStartedOrder),
        complete: flag(step, 'complete'),
      }
    }),
  }
}
