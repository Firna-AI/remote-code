import { expect } from 'vitest'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import {
  ACCOUNT_PATHS,
  type AccountResponse,
  type AgentLoginStatus,
  type SaveAgentLoginRequest,
  type SetDefaultModelRequest,
  type SetNewWorkspaceViewRequest,
} from '../../src/shared/account'
import { GET_STARTED_PATH } from '../../src/shared/onboarding'
import type { SaveShortcutsRequest } from '../../src/shared/shortcuts'
import { TERMS_VERSION } from '../../src/shared/terms'
import { readAccount } from '../../src/app/api/read-core'
import { saveSession, saveUser, type GitHubIdentity } from '../data/users'
import { SESSION_COOKIE } from '../security/cookies'
import { sign } from '../security/crypto'
import { saveGitHubTokens } from '../security/github-tokens'
import { TEST_TIME, type TestHarness } from '../test-support/harness'
import { seedAppAccess } from '../test-support/app-access'

export const operatorModels = [
  {
    agent: 'claude',
    model: 'operator-claude',
    label: 'Claude',
    efforts: ['high'],
  },
  { agent: 'codex', model: 'operator-codex', label: 'Codex', efforts: ['low'] },
]

/** The page of the GitHub App that the harness configures, the default app. */
export const harnessGitHubAppUrl =
  'https://github.com/apps/conductive/installations/new'

export interface AccountState extends Omit<AccountResponse, 'user'> {
  agentLoginComplete: boolean
}

export function isolationAccountStates(
  choice: AgentChoice,
  otherChoice: AgentChoice,
) {
  const noLogins: readonly AgentLoginStatus[] = [
    { agent: 'claude', connected: false },
    { agent: 'codex', connected: false },
  ]
  const firstLogins: readonly AgentLoginStatus[] = [
    {
      agent: 'claude',
      connected: true,
      kind: 'token',
      noReuse: true,
      updatedAt: TEST_TIME,
    },
    { agent: 'codex', connected: false },
  ]
  const otherClaudeLogin: readonly AgentLoginStatus[] = [
    {
      agent: 'claude',
      connected: true,
      kind: 'api-key',
      noReuse: false,
      updatedAt: TEST_TIME,
    },
    { agent: 'codex', connected: false },
  ]
  const otherLogins: readonly AgentLoginStatus[] = [
    {
      agent: 'claude',
      connected: true,
      kind: 'api-key',
      noReuse: false,
      updatedAt: TEST_TIME,
    },
    {
      agent: 'codex',
      connected: true,
      kind: 'token',
      noReuse: true,
      updatedAt: TEST_TIME,
    },
  ]
  const empty: AccountState = {
    operator: false,
    defaultChoice: choice,
    newWorkspaceView: 'dialog',
    shortcuts: { mac: [], other: [] },
    githubAppUrl: harnessGitHubAppUrl,
    agentLogins: noLogins,
    agentLoginComplete: false,
  }
  const firstConnected: AccountState = {
    operator: false,
    defaultChoice: choice,
    newWorkspaceView: 'dialog',
    shortcuts: { mac: [], other: [] },
    githubAppUrl: harnessGitHubAppUrl,
    agentLogins: firstLogins,
    agentLoginComplete: true,
  }
  const firstSaved: AccountState = {
    ...firstConnected,
    defaultChoice: otherChoice,
  }
  const otherConnected: AccountState = {
    operator: false,
    defaultChoice: choice,
    newWorkspaceView: 'dialog',
    shortcuts: { mac: [], other: [] },
    githubAppUrl: harnessGitHubAppUrl,
    agentLogins: otherClaudeLogin,
    agentLoginComplete: true,
  }
  const otherSaved: AccountState = {
    ...otherConnected,
    agentLogins: otherLogins,
  }
  return { empty, firstConnected, firstSaved, otherConnected, otherSaved }
}

export async function expectAccountState(
  harness: TestHarness,
  cookie: string,
  expected: AccountState,
  profile: {
    githubLogin: string
    orgId: string | null
    githubComplete: boolean
  },
): Promise<void> {
  const [response, started] = await Promise.all([
    harness.request(ACCOUNT_PATHS.account, cookie),
    harness.request(GET_STARTED_PATH, cookie),
  ])
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  const { user, ...account } = readAccount(body)
  const { agentLoginComplete, ...expectedAccount } = expected
  expect(user.githubLogin).toBe(profile.githubLogin)
  expect(body, `${profile.githubLogin} account`).toEqual({
    user,
    ...expectedAccount,
  })
  expect(account.defaultChoice, `${profile.githubLogin} default model`).toEqual(
    expected.defaultChoice,
  )
  expect(account.agentLogins, `${profile.githubLogin} agent logins`).toEqual(
    expected.agentLogins,
  )
  expect(started.status).toBe(200)
  expect(await started.json(), `${profile.githubLogin} Get started`).toEqual({
    orgId: profile.orgId,
    steps: [
      { step: 'github-app', complete: profile.githubComplete },
      { step: 'org', complete: profile.orgId !== null },
      { step: 'agent-login', complete: agentLoginComplete },
    ],
  })
}

export async function putAccountValue(
  harness: TestHarness,
  cookie: string,
  path: string,
  body:
    | SaveAgentLoginRequest
    | SetDefaultModelRequest
    | SetNewWorkspaceViewRequest
    | SaveShortcutsRequest,
): Promise<void> {
  const response = await harness.request(path, cookie, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
}

export async function expectIndependentPreferences(
  harness: TestHarness,
  configuredChoice: AgentChoice,
  otherChoice: AgentChoice,
): Promise<void> {
  const cookie = await harness.login()
  const saved = await harness.request(ACCOUNT_PATHS.newWorkspaceView, cookie, {
    method: 'PUT',
    body: JSON.stringify({ view: 'page' }),
  })
  expect(saved.status).toBe(200)
  expect(await saved.json()).toEqual({ view: 'page' })
  const account = async () =>
    readAccount(
      await (await harness.request(ACCOUNT_PATHS.account, cookie)).json(),
    )
  expect(await account()).toMatchObject({
    defaultChoice: configuredChoice,
    newWorkspaceView: 'page',
  })

  harness.env.CONDUCTIVE_DEFAULT_CHOICE = JSON.stringify(otherChoice)
  expect(await account()).toMatchObject({
    defaultChoice: otherChoice,
    newWorkspaceView: 'page',
  })

  await putAccountValue(harness, cookie, ACCOUNT_PATHS.defaultModel, {
    choice: configuredChoice,
  })
  expect(await account()).toMatchObject({
    defaultChoice: configuredChoice,
    newWorkspaceView: 'page',
  })
  await putAccountValue(harness, cookie, ACCOUNT_PATHS.newWorkspaceView, {
    view: 'dialog',
  })
  expect(await account()).toMatchObject({
    defaultChoice: configuredChoice,
    newWorkspaceView: 'dialog',
  })
}

export async function expectInvalidWorkspaceView(
  harness: TestHarness,
): Promise<void> {
  const cookie = await harness.login()
  const response = await harness.request(
    ACCOUNT_PATHS.newWorkspaceView,
    cookie,
    {
      method: 'PUT',
      body: JSON.stringify({ view: 'drawer' }),
    },
  )
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    error: { code: 'invalid_input' },
  })
}

export async function seedBootIdentity(
  harness: TestHarness,
  profile: GitHubIdentity = {
    githubId: 7,
    githubLogin: 'octocat',
    displayName: 'Octocat',
    avatarUrl: null,
    primaryVerifiedEmail: null,
    githubCreatedAt: null,
  },
): Promise<string> {
  const [, , userId, sessionId] = harness.reserveTokens(4)
  const expiresAt = TEST_TIME + 604_800_000
  await saveUser(harness.env.DB, userId, profile, TEST_TIME, TERMS_VERSION)
  await seedAppAccess(harness.env.DB, [userId], TEST_TIME)
  await saveGitHubTokens(
    harness.env,
    userId,
    {
      accessToken: 'github-test-token',
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
    },
    TEST_TIME,
  )
  await saveSession(harness.env.DB, sessionId, userId, expiresAt, TEST_TIME)
  const token = await sign(
    { sessionId, expiresAt },
    'session',
    harness.env.SESSION_SIGNING_KEY,
  )
  return `${SESSION_COOKIE}=${token}`
}
