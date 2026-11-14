import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { ACCOUNT_PATHS, agentLoginPath } from '../../src/shared/account'
import { MODELS_PATH } from '../../src/shared/agents'
import { API_PATHS } from '../../src/shared/api'
import { GET_STARTED_PATH } from '../../src/shared/onboarding'
import { readAccount } from '../../src/app/api/read-core'
import { readAgentLogin } from '../chat/queries'
import {
  createHarness,
  TEST_TIME,
  type TestHarness,
} from '../test-support/harness'
import { expectAccountIsolation } from './boot-account-isolation.test-support'
import {
  expectIndependentPreferences,
  expectInvalidWorkspaceView,
  harnessGitHubAppUrl,
  operatorModels,
} from './boot-account.test-support'

const choice: AgentChoice = {
  agent: 'claude',
  model: 'operator-claude',
  effort: 'high',
  fast: false,
}
const otherChoice: AgentChoice = {
  agent: 'codex',
  model: 'operator-codex',
  effort: 'low',
  fast: false,
}
let harness: TestHarness
beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
  harness.env.CONDUCTIVE_MODELS = JSON.stringify(operatorModels)
  harness.env.CONDUCTIVE_DEFAULT_CHOICE = JSON.stringify(choice)
})
afterAll(async () => harness.dispose())

it('boots from operator models and persists account preferences and encrypted sender logins', async () => {
  const cookie = await harness.login()
  const org = await harness.createOrg(cookie)
  const account = await harness.request(ACCOUNT_PATHS.account, cookie)
  expect(account.status).toBe(200)
  const initial = readAccount(await account.json())
  expect(initial).toMatchObject({
    defaultChoice: choice,
    newWorkspaceView: 'dialog',
    agentLogins: [
      { agent: 'claude', connected: false },
      { agent: 'codex', connected: false },
    ],
    githubAppUrl: harnessGitHubAppUrl,
  })
  const catalog = await harness.request(MODELS_PATH, cookie)
  expect(catalog.status).toBe(200)
  expect(await catalog.json()).toEqual({ models: operatorModels })
  const saved = await harness.request(agentLoginPath('claude'), cookie, {
    method: 'PUT',
    body: JSON.stringify({
      agent: 'claude',
      kind: 'token',
      secret: 'private-login',
    }),
  })
  expect(saved.status).toBe(200)
  expect(await saved.json()).toEqual({
    agent: 'claude',
    connected: true,
    kind: 'token',
    noReuse: true,
    updatedAt: TEST_TIME,
  })
  expect(await readAgentLogin(harness.env, initial.user.id, 'claude')).toEqual({
    agent: 'claude',
    kind: 'token',
    secret: 'private-login',
  })
  const stored = await harness.env.DB.prepare(
    'SELECT ciphertext FROM agent_logins WHERE user_id = ?',
  )
    .bind(initial.user.id)
    .first<{ ciphertext: string }>()
  expect(stored?.ciphertext).not.toContain('private-login')
  const defaultModel = await harness.request(
    ACCOUNT_PATHS.defaultModel,
    cookie,
    {
      method: 'PUT',
      body: JSON.stringify({ choice: otherChoice }),
    },
  )
  expect(defaultModel.status).toBe(200)
  expect(await defaultModel.json()).toEqual({ choice: otherChoice })
  const reloaded = await harness.request(ACCOUNT_PATHS.account, cookie)
  const reloadedBody: unknown = await reloaded.json()
  expect(reloadedBody).toMatchObject({
    defaultChoice: otherChoice,
    agentLogins: [
      {
        agent: 'claude',
        connected: true,
        kind: 'token',
        noReuse: true,
        updatedAt: TEST_TIME,
      },
      { agent: 'codex', connected: false },
    ],
  })
  expect(JSON.stringify(reloadedBody)).not.toContain('private-login')
  const started = await harness.request(GET_STARTED_PATH, cookie)
  expect(started.status).toBe(200)
  expect(await started.json()).toEqual({
    orgId: org.id,
    steps: [
      { step: 'github-app', complete: false },
      { step: 'org', complete: true },
      { step: 'agent-login', complete: true },
    ],
  })
  const removed = await harness.request(agentLoginPath('claude'), cookie, {
    method: 'DELETE',
    body: '{}',
  })
  expect(removed.status).toBe(204)
  expect(
    await readAgentLogin(harness.env, initial.user.id, 'claude'),
  ).toBeNull()
})

it('keeps account data and Get started isolated from other users and deleted orgs', async () => {
  await expectAccountIsolation(harness, choice, otherChoice)
})

it('keeps workspace view and model preferences independent of each other and app defaults', async () => {
  await expectIndependentPreferences(harness, choice, otherChoice)
})

it('rejects an unknown workspace view with invalid_input', async () => {
  await expectInvalidWorkspaceView(harness)
})

it('reports missing operator model configuration without blocking unrelated routes', async () => {
  const cookie = await harness.login()
  delete harness.env.CONDUCTIVE_MODELS
  delete harness.env.CONDUCTIVE_DEFAULT_CHOICE
  const modelsResponse = await harness.request(MODELS_PATH, cookie)
  expect(modelsResponse.status).toBe(503)
  expect(await modelsResponse.json()).toMatchObject({
    error: { code: 'models_unavailable' },
  })
  const fastDefault = await harness.request(
    ACCOUNT_PATHS.defaultModel,
    cookie,
    {
      method: 'PUT',
      body: JSON.stringify({ choice: { ...choice, fast: true } }),
    },
  )
  expect(fastDefault.status).toBe(503)
  expect(await fastDefault.json()).toMatchObject({
    error: { code: 'models_unavailable' },
  })
  const account = await harness.request(ACCOUNT_PATHS.account, cookie)
  expect(account.status).toBe(503)
  expect(await account.json()).toMatchObject({
    error: { code: 'default_model_unavailable' },
  })
  expect((await harness.request(API_PATHS.orgs, cookie)).status).toBe(200)
  expect((await harness.request(GET_STARTED_PATH, cookie)).status).toBe(200)
})
