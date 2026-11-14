import { createHmac, generateKeyPairSync } from 'node:crypto'

import type { WebSocket } from 'miniflare'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { workspaceEventsPath } from '../../src/shared/events'
import { githubPaths } from '../../src/shared/github'
import { sessionsPath } from '../../src/shared/sessions'
import { CLAUDE } from '../chat/harness.test-support'
import { record, string } from '../chat/inputs'
import { closeSockets, SocketInbox } from '../chat/adapter-sockets.test-support'
import {
  outerWorkerBundle,
  OUTER_MACHINE_ORIGIN,
} from '../chat/integration/outer-runtime.test-support'
import {
  OUTER_ORG,
  OUTER_WORKSPACE,
} from '../chat/integration/outer-seed.test-support'
import { RepositoryGitHub } from '../github/fake-repository'
import {
  featureFixture,
  featureState,
  type FeatureFixture,
} from './fixture.test-support'

let bundle: string
let fixture: FeatureFixture | undefined
const sockets: WebSocket[] = []
beforeAll(async () => {
  bundle = await outerWorkerBundle('worker/features/entry.test-support.ts')
})
afterEach(async () => {
  await closeSockets(...sockets)
  sockets.length = 0
  await fixture?.dispose()
})

it('shares chat history with GitHub reads, retries pending reads, and refreshes images from verified pushes', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const api: { current?: RepositoryGitHub } = {}
  const secret = 'webhook-test-secret'
  const active = (fixture = await featureFixture(bundle, {
    configuration: {
      GITHUB_APP_PRIVATE_KEY: privateKey
        .export({ type: 'pkcs1', format: 'pem' })
        .toString(),
      GITHUB_WEBHOOK_SECRET: secret,
    },
    outbound: (request, fallback) => {
      const url = new URL(request.url)
      if (url.pathname === '/app/installations/1/access_tokens')
        return Promise.resolve(Response.json({ token: 'server-token' }))
      return url.pathname === '/graphql' && api.current
        ? api.current.fetch(request)
        : fallback(request)
    },
  }))
  api.current = new RepositoryGitHub(active.github)
  api.current.pulls[2].mergeable = 'UNKNOWN'
  await active.env.DB.batch([
    active.env.DB.prepare(
      "INSERT INTO github_installations (id, account_login, account_type, created_at) VALUES (1, 'Codertocat', 'User', 1)",
    ),
    active.env.DB.prepare(
      "UPDATE repositories SET github_repository_id = 186853002, full_name = 'Codertocat/Hello-World', installation_id = 1 WHERE id = 'chat-repository'",
    ),
    active.env.DB.prepare(
      "UPDATE workspaces SET branch = 'changes' WHERE id = ?",
    ).bind(OUTER_WORKSPACE),
  ])
  const sessionResponse = await active.request(
    sessionsPath(OUTER_ORG, OUTER_WORKSPACE),
    { method: 'POST', body: JSON.stringify({ choice: CLAUDE }) },
  )
  expect(sessionResponse.status).toBe(201)
  expect(
    string(record(record(await sessionResponse.json()).session).id),
  ).not.toBe('')
  const empty = await active.request(
    githubPaths.stored(OUTER_ORG, OUTER_WORKSPACE),
  )
  expect(empty.status).toBe(200)
  expect(await empty.json()).toEqual({ state: null })
  const pending = await active.request(
    githubPaths.banner(OUTER_ORG, OUTER_WORKSPACE),
  )
  expect(pending.status).toBe(503)
  const state = featureState(await active.actor().inspectFeatureState())
  const scheduled = [...state].find(([key]) =>
    key.startsWith('github-refresh:'),
  )
  if (!scheduled) throw new Error('Missing GitHub retry')
  api.current.pulls[2].mergeable = 'MERGEABLE'
  await active.actor().seedFeatureState({
    [scheduled[0]]: { ...record(scheduled[1]), at: 0 },
    'alarm:github': 0,
  })
  await active.actor().advanceStartAlarm()
  const banner = await active.request(
    githubPaths.banner(OUTER_ORG, OUTER_WORKSPACE),
  )
  expect(banner.status).toBe(200)
  expect(await banner.json()).toMatchObject({
    banner: { state: 'ready-to-merge', branch: 'changes' },
  })
  const checks = await active.request(
    githubPaths.checks(OUTER_ORG, OUTER_WORKSPACE),
  )
  expect(checks.status).toBe(200)
  expect(await checks.json()).toMatchObject({
    state: 'available',
    checks: [{ state: 'passed' }],
  })
  const stored = await active.request(
    githubPaths.stored(OUTER_ORG, OUTER_WORKSPACE),
  )
  expect(stored.status).toBe(200)
  expect(await stored.json()).toMatchObject({
    state: {
      banner: { state: 'ready-to-merge', branch: 'changes' },
      checks: { state: 'available', checks: [{ state: 'passed' }] },
    },
  })
  const stream = await active.request(
    workspaceEventsPath(OUTER_ORG, OUTER_WORKSPACE),
    { headers: { Upgrade: 'websocket' } },
  )
  expect(stream.status).toBe(101)
  if (!stream.webSocket) throw new Error('Missing workspace socket')
  sockets.push(stream.webSocket)
  const inbox = new SocketInbox(stream.webSocket)
  stream.webSocket.accept()
  const history = record(record(await inbox.next()).history)
  expect(history.events).toMatchObject([
    { eventNumber: 1, event: { type: 'session.updated' } },
    { eventNumber: 2, event: { type: 'github.updated' } },
  ])
  const body = JSON.stringify({
    repository: { id: 186853002 },
    installation: { id: 1 },
    ref: 'refs/heads/main',
  })
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const webhook = () =>
    active.runtime.dispatchFetch(
      `${OUTER_MACHINE_ORIGIN}${MACHINE_PATHS.githubWebhook}`,
      {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'production-push',
        },
      },
    )
  expect((await webhook()).status).toBe(204)
  expect(
    await active.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM image_builds WHERE org_id = ? AND kind = 'refresh'",
    )
      .bind(OUTER_ORG)
      .first('count'),
  ).toBe(1)
  expect((await webhook()).status).toBe(204)
  expect(
    await active.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM image_builds WHERE org_id = ? AND kind = 'refresh'",
    )
      .bind(OUTER_ORG)
      .first('count'),
  ).toBe(1)
})
