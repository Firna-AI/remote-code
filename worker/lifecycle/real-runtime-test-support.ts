import { mkdir, mkdtemp } from 'node:fs/promises'

import { Miniflare, Response as RuntimeResponse, WebSocket } from 'miniflare'

import { workspaceEventsPath } from '../../src/shared/events'
import { closeSockets, SocketInbox } from '../chat/adapter-sockets.test-support'
import type { LifecycleEnvironment } from './runtime'
import { LifecycleBoat } from './lifecycle-boat-test-support'
import type { WorkspaceRuntimeFixture } from './workspace-runtime-test-worker'
import { SESSION_COOKIE } from '../security/cookies'
import { seedAppAccess } from '../test-support/app-access'
import { encrypt, sign } from '../security/crypto'
import { agentLoginContext } from '../chat/queries'
import { migratedStorage, TEST_D1_ID } from '../test-support/migrated-storage'
import { workerLibraryBundle } from '../test-support/test-bundles'
import { seedPublishedImage } from './published-image-test-support'
import { readWorkspaceToken } from './tokens'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { withSoftwareRelease } from './software-release-test-support'

export function runtimeBundle(): Promise<string> {
  return workerLibraryBundle(
    `${import.meta.dirname}/workspace-runtime-test-worker.ts`,
  )
}

interface RuntimeBindings {
  DB: D1Database
  WORKSPACES: DurableObjectNamespace<WorkspaceRuntimeFixture>
}

export async function realRuntimeFixture(bundle: string) {
  const root = `${import.meta.dirname}/../../.context/boat-native-remote-workspaces/8i/completion/legacy-runtime`
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(`${root}/case-`)
  await migratedStorage(directory)
  const boat = new LifecycleBoat()
  const sockets = new Set<WebSocket>()
  const requests: string[] = []
  let redirects = false
  const text = (value: string) => ({ type: 'text' as const, value })
  const create = () =>
    new Miniflare({
      enableDevRegistry: false,
      telemetry: { enabled: false },
      cf: false,
      resourcePersistencePath: directory,
      workers: [
        {
          config: {
            name: 'workspace-runtime-test',
            compatibilityDate: '2026-11-06',
            compatibilityFlags: ['global_fetch_strictly_public'],
            exports: {
              WorkspaceRuntimeFixture: {
                type: 'durable-object',
                storage: 'sqlite',
              },
            },
            env: {
              WORKSPACES: {
                type: 'durable-object',
                worker: 'workspace-runtime-test',
                exportName: 'WorkspaceRuntimeFixture',
              },
              DB: { type: 'd1', id: TEST_D1_ID },
              APP_ORIGIN: text('https://app.conductive.test'),
              MACHINE_ORIGIN: text('https://machine.conductive.test'),
              GITHUB_CLIENT_ID: text('runtime-client'),
              GITHUB_CLIENT_SECRET: text('runtime-client-secret'),
              SESSION_SIGNING_KEY: text(btoa('s'.repeat(32))),
              BOAT_API_KEY: text('boat-first'),
              BOAT_ORG_ID: text('app-org'),
              BOAT_KEY_ENCRYPTION_KEY: text(btoa('e'.repeat(32))),
            },
            manifest: {
              mainModule: 'index.js',
              modules: { 'index.js': { type: 'esm', contents: bundle } },
            },
          },
          dev: {
            outboundService: {
              type: 'fetcher',
              handler: async (incoming) => {
                requests.push(incoming.url)
                if (redirects)
                  return new RuntimeResponse('redirect refused', {
                    status: 302,
                    headers: {
                      Location: 'https://credentials-must-not-follow.test/leak',
                    },
                  })
                const request = new Request(incoming.url, {
                  method: incoming.method,
                  headers: [...incoming.headers.entries()],
                  body: ['GET', 'HEAD'].includes(incoming.method)
                    ? undefined
                    : await incoming.arrayBuffer(),
                  redirect: 'manual',
                })
                const response = await withSoftwareRelease(boat.fetch)(request)
                return new RuntimeResponse(await response.arrayBuffer(), {
                  status: response.status,
                  headers: [...response.headers.entries()],
                })
              },
            },
          },
        },
      ],
    })
  let runtime = create()
  let bindings = await runtime.getBindings<RuntimeBindings>()
  const database = bindings.DB
  const env: LifecycleEnvironment = {
    DB: database,
    WORKSPACES: bindings.WORKSPACES,
    APP_ORIGIN: 'https://app.conductive.test',
    MACHINE_ORIGIN: 'https://machine.conductive.test',
    GITHUB_CLIENT_ID: 'runtime-client',
    GITHUB_CLIENT_SECRET: 'runtime-client-secret',
    SESSION_SIGNING_KEY: btoa('s'.repeat(32)),
    BOAT_API_KEY: 'boat-first',
    BOAT_ORG_ID: 'app-org',
    BOAT_KEY_ENCRYPTION_KEY: btoa('e'.repeat(32)),
  }
  await database.batch([
    database.prepare(
      "INSERT INTO users (id, github_id, github_login, created_at, updated_at) VALUES ('runtime-user', 11, 'octocat', 0, 0)",
    ),
    database.prepare(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ('runtime-browser-session', 'runtime-user', 4000000000000)",
    ),
    database.prepare(
      "INSERT INTO orgs (id, name, creator_user_id, created_at) VALUES ('runtime-org', 'Runtime org', 'runtime-user', 0)",
    ),
    database.prepare(
      "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ('runtime-org', 'runtime-user', 'admin', 0)",
    ),
    database.prepare(
      "INSERT INTO repositories (id, org_id, github_repository_id, full_name, default_branch, installation_id) VALUES ('runtime-repo', 'runtime-org', 11, 'example/runtime', 'main', 91)",
    ),
    database.prepare(
      "INSERT INTO settings (org_id, updated_at) VALUES ('runtime-org', 0)",
    ),
  ])
  await seedAppAccess(database, ['runtime-user'], 0)
  await database
    .prepare(
      `INSERT INTO agent_logins
    (user_id, agent, kind, ciphertext, created_at, updated_at)
    VALUES ('runtime-user', 'codex', 'api-key', ?, 0, 0)`,
    )
    .bind(
      await encrypt(
        'runtime-agent-key',
        agentLoginContext('runtime-user', 'codex'),
        env.BOAT_KEY_ENCRYPTION_KEY,
      ),
    )
    .run()
  await seedPublishedImage(database, {
    orgId: 'runtime-org',
    buildId: 'base-runtime-build',
    imageName: 'base-runtime-image',
    runnerProtocolVersion: 1,
    repositories: [
      {
        id: 'runtime-repo',
        orgId: 'runtime-org',
        fullName: 'example/runtime',
        defaultBranch: 'main',
      },
    ],
    software: {
      url: 'https://software.conductive.test/runner.tar.gz',
      sha256: 'a'.repeat(64),
    },
    now: Date.now(),
  })
  const sessionToken = await sign(
    { sessionId: 'runtime-browser-session', expiresAt: 4_000_000_000_000 },
    'session',
    env.SESSION_SIGNING_KEY,
  )
  const closeBrowsers = async () => {
    await closeSockets(...sockets)
    sockets.clear()
  }
  const openSocket = async (url: string, headers: Record<string, string>) => {
    const response = await runtime.dispatchFetch(url, {
      headers: { Upgrade: 'websocket', ...headers },
    })
    const socket = response.webSocket
    if (!socket) throw new Error(`No socket. Status: ${response.status}`)
    const inbox = new SocketInbox(socket)
    sockets.add(socket)
    let isClosed = false
    const closed = new Promise<void>((resolve) => {
      socket.addEventListener(
        'close',
        () => {
          isClosed = true
          if (socket.readyState === WebSocket.READY_STATE_CLOSING)
            socket.close(1000, 'Connection closed.')
          sockets.delete(socket)
          resolve()
        },
        { once: true },
      )
    })
    socket.accept()
    return {
      response,
      inbox,
      closed,
      send: (value: unknown) => socket.send(JSON.stringify(value)),
      get isClosed() {
        return isClosed
      },
    }
  }
  return {
    boat,
    requests,
    env,
    closeConnections: closeBrowsers,
    actor: (id: string) => bindings.WORKSPACES.getByName(id),
    fetch: (path: string) =>
      runtime.dispatchFetch(`https://runtime.test${path}`),
    request: (path: string, body: unknown) =>
      runtime.dispatchFetch(`${env.APP_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          Origin: env.APP_ORIGIN ?? '',
          Cookie: `${SESSION_COOKIE}=${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    openEvents: async (
      id: string,
      after = 0,
      headers: Record<string, string> = {},
    ) =>
      openSocket(
        `${env.APP_ORIGIN}${workspaceEventsPath('runtime-org', id, after)}`,
        {
          Origin: env.APP_ORIGIN,
          Cookie: `${SESSION_COOKIE}=${sessionToken}`,
          ...headers,
        },
      ),
    openRunner: async (id: string) =>
      openSocket(`${env.MACHINE_ORIGIN}${MACHINE_PATHS.runner}`, {
        Authorization: `Bearer ${await readWorkspaceToken(env, id)}`,
      }),
    refuseRedirects: () => {
      redirects = true
      requests.length = 0
    },
    restart: async (disconnect = true) => {
      if (disconnect) await closeBrowsers()
      await runtime.dispose()
      runtime = create()
      bindings = await runtime.getBindings<RuntimeBindings>()
      env.DB = bindings.DB
      env.WORKSPACES = bindings.WORKSPACES
    },
    dispose: async () => {
      await closeBrowsers()
      await runtime.dispose()
    },
  }
}
