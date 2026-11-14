import type { WebSocket } from 'miniflare'
import { afterEach, beforeAll, expect, it } from 'vitest'

import {
  MACHINE_PATHS,
  TOOL_TURN_HEADER,
} from '../../../src/shared/agent-tools'
import { chatHistoryPath } from '../../../src/shared/events'
import { sessionPaths } from '../../../src/shared/sessions'

import { IMAGE_SOURCE_CREDENTIAL_PATH } from '../../lifecycle/image-sources/credential'
import { saveGitHubTokens } from '../../security/github-tokens'
import { closeSockets } from '../adapter-sockets.test-support'
import {
  OUTER_MACHINE_ORIGIN,
  outerWorkerBundle,
} from './outer-runtime.test-support'
import {
  OTHER_TOKEN,
  OUTER_ORG,
  OUTER_TOKEN,
  OUTER_WORKSPACE,
} from './outer-seed.test-support'
import { OuterFakeRunner, requestRunner } from './runner-socket.test-support'
import { createLifecycleChatFixture } from './workspace-lifecycle.test-support'

let bundle: string
let fixture: Awaited<ReturnType<typeof createLifecycleChatFixture>> | undefined
const sockets: WebSocket[] = []
beforeAll(async () => {
  bundle = await outerWorkerBundle()
})
afterEach(async () => {
  await closeSockets(...sockets)
  sockets.length = 0
  await fixture?.dispose()
  fixture = undefined
})

it('keeps machine credential routes behind their own token gates and uses the trusted turn sender', async () => {
  const active = (fixture = await createLifecycleChatFixture(bundle))
  await active.initialize()
  await saveGitHubTokens(
    active.env,
    'owner',
    {
      accessToken: 'owner-github-token',
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
    },
    1,
  )
  const request = (path: string, token?: string) =>
    active.runtime.dispatchFetch(`${OUTER_MACHINE_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        [TOOL_TURN_HEADER]: 'first-turn',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  const missing = await request(MACHINE_PATHS.gitCredential)
  expect(missing.status).toBe(401)
  expect(await missing.json()).toMatchObject({
    error: { code: 'workspace_token_refused' },
  })
  const foreign = await request(MACHINE_PATHS.gitCredential, OTHER_TOKEN)
  expect(foreign.status).toBe(409)
  expect(await foreign.json()).toMatchObject({
    error: { code: 'current_turn_required' },
  })
  await active.actor().beginLifecycleStart('create')
  await active.actor().lifecyclePrepared()
  const runner = await connectCredentialRunner(active)
  expect(await runner.inbox.next()).toMatchObject({
    type: 'turn',
    turnId: 'first-turn',
  })
  const credential = await request(MACHINE_PATHS.gitCredential, OUTER_TOKEN)
  expect(credential.status).toBe(200)
  expect(credential.headers.get('Cache-Control')).toBe('no-store')
  expect(await credential.json()).toEqual({ token: 'owner-github-token' })
  const noGrant = await request(IMAGE_SOURCE_CREDENTIAL_PATH)
  expect(noGrant.status).toBe(401)
  expect(await noGrant.json()).toMatchObject({
    error: { code: 'build_grant_refused' },
  })
  const workspaceToken = await request(
    IMAGE_SOURCE_CREDENTIAL_PATH,
    OUTER_TOKEN,
  )
  expect(workspaceToken.status).toBe(401)
  expect(await workspaceToken.json()).toMatchObject({
    error: { code: 'build_grant_refused' },
  })
})

it.each([
  {
    end: 'Stop',
    path: sessionPaths.interrupt,
    body: { turnId: 'first-turn' },
  },
  {
    end: 'session close',
    path: sessionPaths.close,
    body: { stopRunningTurn: false },
  },
])('denies GitHub access after a queued $end', async ({ path, body }) => {
  const active = (fixture = await createLifecycleChatFixture(bundle))
  await active.initialize()
  await active.actor().beginLifecycleStart('create')
  const ended = await active.request(
    path(OUTER_ORG, OUTER_WORKSPACE, 'first-session'),
    { method: 'POST', body: JSON.stringify(body) },
  )
  expect(ended.status).toBe(200)
  await active.actor().lifecyclePrepared()
  const runner = await connectCredentialRunner(active)
  expect(await active.actor().readLifecycle()).toMatchObject({
    state: 'ready',
    runningSessions: [],
  })
  expect(runner.received).toHaveLength(2)
  const response = await credentialRequest(active)
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    error: { code: 'current_turn_required' },
  })
  const history = await active.request(
    chatHistoryPath(OUTER_ORG, OUTER_WORKSPACE, 'first-session'),
  )
  expect(await history.json()).toMatchObject({
    events: expect.arrayContaining([
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'turn.completed',
          turnId: 'first-turn',
          state: 'stopped',
        }),
      }),
    ]),
  })
})

it('denies GitHub access after a queued login failure', async () => {
  const active = (fixture = await createLifecycleChatFixture(bundle))
  await active.initialize()
  await active.env.DB.prepare(
    "DELETE FROM agent_logins WHERE user_id = 'owner' AND agent = 'claude'",
  ).run()
  await active.actor().beginLifecycleStart('create')
  await active.actor().lifecyclePrepared()
  const runner = await connectCredentialRunner(active)
  expect(runner.received).toHaveLength(2)
  const history = await active.request(
    chatHistoryPath(OUTER_ORG, OUTER_WORKSPACE, 'first-session'),
  )
  expect(await history.json()).toMatchObject({
    events: expect.arrayContaining([
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'turn.failed',
          turnId: 'first-turn',
          error: expect.objectContaining({ code: 'agent_login_required' }),
        }),
      }),
    ]),
  })
  const response = await credentialRequest(active)
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    error: { code: 'current_turn_required' },
  })
})

async function connectCredentialRunner(
  active: Awaited<ReturnType<typeof createLifecycleChatFixture>>,
) {
  const connected = await requestRunner(active)
  if (connected.status !== 101 || !connected.webSocket)
    throw new Error('The runner socket is missing.')
  sockets.push(connected.webSocket)
  const runner = new OuterFakeRunner(connected.webSocket)
  expect(await runner.inbox.next()).toMatchObject({ type: 'welcome' })
  runner.emit({ type: 'runner.ready' })
  expect(await runner.inbox.next()).toMatchObject({
    type: 'confirm',
    throughEventNumber: 1,
  })
  await active.actor().readLifecycle()
  return runner
}

async function credentialRequest(
  active: Awaited<ReturnType<typeof createLifecycleChatFixture>>,
) {
  await saveGitHubTokens(
    active.env,
    'owner',
    {
      accessToken: 'owner-github-token',
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
    },
    1,
  )
  return active.runtime.dispatchFetch(
    `${OUTER_MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OUTER_TOKEN}`,
        [TOOL_TURN_HEADER]: 'first-turn',
      },
    },
  )
}
