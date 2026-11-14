import type { Agent } from './generated/Agent'
import type { AgentChoice } from './generated/AgentChoice'
import type { Timestamp } from './generated/Timestamp'
import type { User } from './api'
import type { ShortcutPreferences } from './shortcuts'

export interface SessionResponse {
  user: User
  appAccess: boolean
}

export const ACCOUNT_PATHS = {
  account: '/api/account',
  defaultModel: '/api/account/default-model',
  newWorkspaceView: '/api/account/new-workspace-view',
  shortcuts: '/api/account/shortcuts',
  agentLogins: '/api/account/agent-logins',
  codexDevice: '/api/account/agent-logins/codex/device',
  githubInstallations: '/api/account/github-installations',
  githubRepositories: '/api/account/github-repositories',
  deleteAccount: '/api/account/delete',
} as const

export const NEW_WORKSPACE_VIEWS = ['page', 'dialog'] as const
export type NewWorkspaceView = (typeof NEW_WORKSPACE_VIEWS)[number]

export function agentLoginPath(agent: Agent): string {
  return `${ACCOUNT_PATHS.agentLogins}/${agent}`
}

export function refreshAgentLoginModelsPath(agent: Agent): string {
  return `${agentLoginPath(agent)}/models/refresh`
}

export interface EndpointModelList {
  /** App model IDs absent from the last successful endpoint list. */
  missing: readonly string[]
  checkedAt: Timestamp
}

export function codexDevicePath(handle: string): string {
  return `${ACCOUNT_PATHS.codexDevice}/${encodeURIComponent(handle)}`
}

export interface StartCodexDeviceResponse {
  handle: string
  userCode: string
  verificationUrl: string
  expiresAt: Timestamp
  pollIntervalMs: number
}

export type PollCodexDeviceResponse =
  | { state: 'waiting'; pollIntervalMs: number }
  | { state: 'connected'; login: AgentLoginStatus }
  | { state: 'expired' }
  | { state: 'failed'; cause: string }

/** Secrets occur only in writes and runner commands, never in account responses. */
export type SaveAgentLoginRequest =
  | { agent: 'claude'; kind: 'token' | 'api-key'; secret: string }
  | { agent: 'codex'; kind: 'api-key'; secret: string }
  | { agent: Agent; kind: 'endpoint'; endpoint: string; secret: string }

type AgentLoginKinds = {
  [A in Agent]: Extract<AgentLoginStatus, { connected: true }>['kind']
}

const loginNoReuseDefaults: {
  [A in Agent]: Record<AgentLoginKinds[A], boolean>
} = {
  claude: { token: true, 'api-key': false, endpoint: false },
  codex: { token: true, 'api-key': false, endpoint: false },
}

export function defaultAgentLoginNoReuse<A extends Agent>(
  agent: A,
  kind: AgentLoginKinds[A],
): boolean {
  return loginNoReuseDefaults[agent][kind]
}

export type AgentLoginStatus =
  | { agent: Agent; connected: false }
  | {
      agent: 'claude'
      connected: true
      kind: 'token' | 'api-key'
      noReuse: boolean
      updatedAt: Timestamp
    }
  | {
      agent: 'codex'
      connected: true
      kind: 'token' | 'api-key'
      noReuse: boolean
      updatedAt: Timestamp
      unusableCause?: string
    }
  | {
      agent: Agent
      connected: true
      kind: 'endpoint'
      host: string
      modelList?: EndpointModelList
      noReuse: boolean
      updatedAt: Timestamp
    }

export interface GitHubInstallation {
  id: number
  account: string
  repositoryCount: number
  settingsUrl: string
}

/** A repository that the signed-in user and the GitHub App can both reach. */
export interface GitHubRepository {
  /** GitHub's numeric ID. An org does not need to exist yet. */
  githubId: number
  fullName: string
  description: string
  defaultBranch: string
  installationId: number
}

export interface AccountResponse {
  user: User
  operator: boolean
  defaultChoice: AgentChoice
  newWorkspaceView: NewWorkspaceView
  shortcuts: ShortcutPreferences
  agentLogins: readonly AgentLoginStatus[]
  /**
   * The page of the shared GitHub App on GitHub. It lists the GitHub
   * accounts of the person. An account with the app opens the settings
   * of its installation, where the person chooses the repositories that
   * the app reaches. Another account installs the app.
   */
  githubAppUrl: string
}

export type SaveAgentLoginResponse = AgentLoginStatus
export interface UpdateAgentLoginRequest {
  noReuse: boolean
}
export type UpdateAgentLoginResponse = AgentLoginStatus
export interface SetDefaultModelRequest {
  choice: AgentChoice
}
export type SetDefaultModelResponse = SetDefaultModelRequest
export interface SetNewWorkspaceViewRequest {
  view: NewWorkspaceView
}
export type SetNewWorkspaceViewResponse = SetNewWorkspaceViewRequest
export interface GitHubInstallationsResponse {
  installations: readonly GitHubInstallation[]
  installUrl: string
}
export interface GitHubRepositoriesResponse {
  repositories: readonly GitHubRepository[]
}
