import { Miniflare, type WebSocket } from 'miniflare'

import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import {
  deviceConnectionPath,
  DEVICE_COMMAND_PATH,
  machineDeviceCommandPath,
} from '../../src/shared/device'
import { sessionsPath, sessionPaths } from '../../src/shared/sessions'
import { CLAUDE } from '../chat/harness.test-support'
import { closeSockets, SocketInbox } from '../chat/adapter-sockets.test-support'
import { agentLoginContext } from '../chat/queries'
import { record, string } from '../chat/inputs'
import { SESSION_COOKIE } from '../security/cookies'
import {
  DESKTOP_ORIGIN,
  DESKTOP_SESSION_COOKIE,
} from '../security/desktop-contract'
import { encrypt, hash, sign } from '../security/crypto'
import { migratedStorage, TEST_D1_ID } from '../test-support/migrated-storage'
import { workerLibraryBundle } from '../test-support/test-bundles'
import { seedAppAccess } from '../test-support/app-access'

export const APP = 'https://app.conductive.test'
const MACHINE = 'https://machine.conductive.test'
export const WID = 'device-workspace'
const TOKEN = 'device-workspace-token'
const KEY = btoa('s'.repeat(32))
export async function deviceFixture(options: { entry?: string } = {}) {
  const storage = await migratedStorage()
  const runtime = new Miniflare({
    enableDevRegistry: false,
    telemetry: { enabled: false },
    cf: false,
    resourcePersistencePath: storage.path,
    workers: [
      {
        config: {
          name: 'device-tests',
          compatibilityDate: '2026-11-06',
          exports: { Workspace: { type: 'durable-object', storage: 'sqlite' } },
          env: {
            DB: { type: 'd1', id: TEST_D1_ID },
            WORKSPACES: {
              type: 'durable-object',
              worker: 'device-tests',
              exportName: 'Workspace',
            },
            APP_ORIGIN: { type: 'text', value: APP },
            MACHINE_ORIGIN: { type: 'text', value: MACHINE },
            SESSION_SIGNING_KEY: { type: 'text', value: KEY },
            BOAT_KEY_ENCRYPTION_KEY: { type: 'text', value: KEY },
          },
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: await workerLibraryBundle(
                  options.entry ?? 'worker/devices/test-worker.test-support.ts',
                ),
              },
            },
          },
        },
      },
    ],
  })
  const db = await runtime.getD1Database('DB')
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, github_id, github_login, created_at, updated_at) VALUES ('owner', 101, 'owner', 1, 1), ('sender', 102, 'sender', 1, 1), ('outsider', 103, 'outsider', 1, 1)",
    ),
    db.prepare(
      "INSERT INTO orgs (id, name, creator_user_id, created_at) VALUES ('org', 'Org', 'owner', 1)",
    ),
    db.prepare(
      "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ('org', 'owner', 'admin', 1), ('org', 'sender', 'member', 1)",
    ),
    db.prepare(
      "INSERT INTO sections (id, org_id, name, is_default, position, created_at) VALUES ('section', 'org', 'General', 1, 0, 1)",
    ),
    db.prepare(
      "INSERT INTO repositories (id, org_id, github_repository_id, full_name, default_branch) VALUES ('repo', 'org', 1, 'owner/repo', 'main')",
    ),
    db
      .prepare(
        "INSERT INTO workspaces (id, org_id, repository_id, owner_user_id, section_id, name, branch, state, created_at, updated_at) VALUES (?, 'org', 'repo', 'owner', 'section', 'Workspace', 'owner/workspace', 'working', 1, 1)",
      )
      .bind(WID),
    db
      .prepare(
        'INSERT INTO workspace_tokens (workspace_id, token_hash, ciphertext, created_at) VALUES (?, ?, ?, 1)',
      )
      .bind(WID, await hash(TOKEN), 'unused'),
    db
      .prepare(
        "INSERT INTO agent_logins (user_id, agent, kind, ciphertext, created_at, updated_at) VALUES ('sender', 'claude', 'api-key', ?, 1, 1)",
      )
      .bind(await encrypt('login', agentLoginContext('sender', 'claude'), KEY)),
  ])
  await seedAppAccess(db, ['owner', 'sender', 'outsider'], 1)
  const sockets: WebSocket[] = []
  const closed = new Set<WebSocket>()
  const remember = (socket: WebSocket) => {
    sockets.push(socket)
    socket.addEventListener(
      'close',
      () => {
        if (socket.readyState !== 3) socket.close()
        closed.add(socket)
      },
      { once: true },
    )
  }
  const tokenFor = async (userId: string, sessionId = `${userId}-session`) => {
    await db
      .prepare(
        'INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
      )
      .bind(sessionId, userId, 4_000_000_000_000)
      .run()
    return sign({ sessionId, expiresAt: 4_000_000_000_000 }, 'session', KEY)
  }
  const senderToken = await tokenFor('sender')
  const ownerToken = await tokenFor('owner')
  const appHeaders = (token = senderToken, desktop = false) => ({
    Origin: desktop ? DESKTOP_ORIGIN : APP,
    Cookie: `${desktop ? DESKTOP_SESSION_COOKIE : SESSION_COOKIE}=${token}`,
    'Content-Type': 'application/json',
  })
  const app = (
    path: string,
    body?: unknown,
    token = senderToken,
    desktop = false,
  ) =>
    runtime.dispatchFetch(APP + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: appHeaders(token, desktop),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  const created = await app(sessionsPath('org', WID), { choice: CLAUDE })
  const sessionId = string(record(record(await created.json()).session).id)
  await app(sessionPaths.messages('org', WID, sessionId), {
    id: 'first-message',
    text: 'Run a command',
    choice: CLAUDE,
    attachmentIds: [],
  })
  const runnerResponse = await runtime.dispatchFetch(
    MACHINE + MACHINE_PATHS.runner,
    {
      headers: { Authorization: `Bearer ${TOKEN}`, Upgrade: 'websocket' },
    },
  )
  const runner = runnerResponse.webSocket
  if (!runner) throw new Error('Missing runner socket.')
  remember(runner)
  const runnerInbox = new SocketInbox(runner)
  runner.accept()
  runner.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: 2,
      workspaceId: WID,
      streamId: 'stream',
    }),
  )
  await runnerInbox.next()
  runner.send(
    JSON.stringify({
      type: 'event',
      streamId: 'stream',
      eventNumber: 1,
      occurredAt: 1,
      event: { type: 'runner.ready' },
    }),
  )
  await runnerInbox.next()
  const turn = record(await runnerInbox.next())
  const turnId = string(turn.turnId)
  const machine = (
    body?: unknown,
    suffix = '',
    selectedTurn = turnId,
    token = TOKEN,
  ) =>
    runtime.dispatchFetch(MACHINE + DEVICE_COMMAND_PATH + suffix, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        [TOOL_TURN_HEADER]: selectedTurn,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  const connect = async (
    token = senderToken,
    deviceId = 'sender-mac',
    proof = true,
    deviceName?: string,
  ) => {
    const response = await runtime.dispatchFetch(
      APP + deviceConnectionPath(deviceId, deviceName),
      {
        headers: {
          ...appHeaders(token, true),
          Upgrade: 'websocket',
          ...(proof && { Authorization: `Bearer ${token}` }),
        },
      },
    )
    if (!response.webSocket)
      return { response, socket: null, inbox: null, device: null }
    const socket = response.webSocket
    remember(socket)
    const inbox = new SocketInbox(socket)
    socket.accept()
    const ready = record(await inbox.next())
    return { response, socket, inbox, device: record(ready.device) }
  }
  return {
    runtime,
    remember,
    db,
    app,
    appHeaders,
    machine,
    readCommand: (requestKey: string) =>
      machine(
        undefined,
        machineDeviceCommandPath(requestKey).slice(DEVICE_COMMAND_PATH.length),
      ),
    connect,
    tokenFor,
    senderToken,
    ownerToken,
    turnId,
    sessionId,
    runner,
    runnerInbox,
    input: (requestId = 'command-1') => ({
      requestId,
      command: ' echo exact ',
      folder: '/Users/sender/project ',
      reason: 'Check a local file',
    }),
    dispose: async () => {
      await Promise.all([
        closeSockets(...sockets.filter((socket) => !closed.has(socket))),
        runtime.dispose(),
      ])
      await storage.remove()
    },
  }
}

export type DeviceFixture = Awaited<ReturnType<typeof deviceFixture>>
