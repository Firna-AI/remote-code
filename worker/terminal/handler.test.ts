import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { terminalPaths } from '../../src/shared/terminal'
import { createToolsHarness, type ToolsHarness } from '../previews/test-support'
import { decrypt } from '../security/crypto'
import { TEST_TIME } from '../test-support/harness'
import { createTerminalHandler } from './handler'
import { startWorkspaceTerminal, terminalStartCommand } from './service'

let harness: ToolsHarness
beforeAll(async () => {
  harness = await createToolsHarness()
})
beforeEach(async () => {
  await harness.resetTools()
})
afterAll(async () => {
  await harness.dispose()
})

it('caches separate workspace secrets from run storage without exposing a password', async () => {
  const seed = await harness.seed()
  await startWorkspaceTerminal(
    harness.env,
    seed.orgId,
    seed.workspaceId,
    harness.dependencies,
  )
  const row = await harness.env.DB.prepare(
    'SELECT ciphertext FROM terminal_credentials WHERE workspace_id = ?',
  )
    .bind(seed.workspaceId)
    .first<{ ciphertext: string }>()
  expect(row?.ciphertext.startsWith('v1.')).toBe(true)
  const command = terminalStartCommand()
  expect(command).not.toContain('/run/conductive-terminal/password')
  expect(new URL(harness.requests[0].url).searchParams.get('path')).toBe(
    '/home/user/.conductive-terminal/password',
  )
  expect(command).toContain('systemctl start conductive-terminal.service')
  expect(command).not.toContain('/etc/conductive')
  expect(command).not.toContain(row?.ciphertext)
  await harness.env.DB.prepare(
    `INSERT INTO workspaces (id, org_id, repository_id, owner_user_id, name, branch,
     sandbox_id, state, created_at, updated_at)
     SELECT 'workspace-two', org_id, repository_id, owner_user_id, 'Other', 'octocat/other',
     'bx_two', 'starting', created_at, updated_at FROM workspaces WHERE id = ?`,
  )
    .bind(seed.workspaceId)
    .run()
  await startWorkspaceTerminal(
    harness.env,
    seed.orgId,
    'workspace-two',
    harness.dependencies,
  )
  expect(harness.requests[1].url).not.toBe(harness.requests[0].url)
  expect(
    await harness.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM terminal_credentials',
    ).first<number>('count'),
  ).toBe(2)
})

it('returns ready, starting, and stopped terminal states without exposing a password', async () => {
  const seed = await harness.seed()
  await startWorkspaceTerminal(
    harness.env,
    seed.orgId,
    seed.workspaceId,
    harness.dependencies,
  )
  const handler = createTerminalHandler(harness.env, harness.dependencies)
  const path = terminalPaths.connection(seed.orgId, seed.workspaceId)
  const ready = await handler.fetch(seed.request(path))
  expect(ready.status).toBe(200)
  expect(await ready.json()).toEqual({
    state: 'ready',
    protocol: 'tty',
    socketPath: terminalPaths.socket(seed.orgId, seed.workspaceId),
  })
  for (const state of ['starting', 'stopped']) {
    await harness.env.DB.prepare('UPDATE workspaces SET state = ? WHERE id = ?')
      .bind(state, seed.workspaceId)
      .run()
    const response = await handler.fetch(seed.request(path))
    expect(await response.json()).toEqual({ state, socketPath: null })
  }
  expect(harness.requests).toHaveLength(1)
})

it('authenticates the ttyd handshake and forwards automatic replies without reporting activity', async () => {
  const seed = await harness.seed()
  await startWorkspaceTerminal(
    harness.env,
    seed.orgId,
    seed.workspaceId,
    harness.dependencies,
  )
  const handler = createTerminalHandler(harness.env, harness.dependencies)
  const request = seed.request(
    terminalPaths.socket(seed.orgId, seed.workspaceId),
    {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': 'tty',
        Cookie: 'ignored',
      },
    },
  )
  harness.setNow(TEST_TIME + 1000)
  const response = await handler.fetch(request)
  expect(response.status).toBe(101)
  expect(response.headers.get('Sec-WebSocket-Protocol')).toBe('tty')
  expect(response.headers.get('Authorization')).toBe(null)
  const upstreamRequest = harness.requests[2]
  expect(upstreamRequest.url).toBe('https://sandbox-7681.on.boat.dev/ws')
  expect(upstreamRequest.headers.get('Cookie')).toBe(
    '_port_auth=server-port-token',
  )
  const stored = await harness.env.DB.prepare(
    'SELECT ciphertext FROM terminal_credentials WHERE workspace_id = ?',
  )
    .bind(seed.workspaceId)
    .first<{ ciphertext: string }>()
  const password = await decrypt(
    stored?.ciphertext ?? '',
    JSON.stringify(['terminal-password', seed.workspaceId]),
    harness.env.BOAT_KEY_ENCRYPTION_KEY,
  )
  expect(upstreamRequest.headers.get('Authorization')).toBe(
    `Basic ${btoa(`conductive:${password}`)}`,
  )
  const upstream = harness.upstreamSockets[0]
  const browser = harness.serverSockets[0]
  const handshake = upstream.nextMessage()
  browser.emit(
    new TextEncoder()
      .encode('{"columns":80,"rows":24,"AuthToken":"forged"}')
      .slice().buffer,
  )
  const authenticated = await handshake
  expect(typeof authenticated).toBe('string')
  expect(JSON.parse(String(authenticated))).toEqual({
    columns: 80,
    rows: 24,
    AuthToken: btoa(`conductive:${password}`),
  })
  expect(await harness.status()).toEqual({ activity: TEST_TIME })
  const output = browser.nextMessage()
  upstream.emit(Uint8Array.of(48, 111, 107).buffer)
  expect(await output).toEqual(Uint8Array.of(48, 111, 107).buffer)
  const resize = upstream.nextMessage()
  browser.emit('1{"columns":100,"rows":30}')
  expect(await resize).toBe('1{"columns":100,"rows":30}')
  expect(await harness.status()).toEqual({ activity: TEST_TIME })
  const reply = upstream.nextMessage()
  browser.emit('0\u001b[1;1R')
  expect(await reply).toBe('0\u001b[1;1R')
  await harness.activity()
  expect(await harness.status()).toEqual({ activity: TEST_TIME })
  const input = upstream.nextMessage()
  browser.emit(Uint8Array.of(48, 108, 115, 13).buffer)
  expect(await input).toEqual(Uint8Array.of(48, 108, 115, 13).buffer)
  await harness.activity()
  expect(await harness.status()).toEqual({ activity: TEST_TIME })
  browser.close(1000, 'closed')
  await upstream.end
  expect(upstream.closed?.code).toBe(1000)
})

it('rejects a ttyd socket without the tty protocol before contacting the sandbox', async () => {
  const seed = await harness.seed()
  const handler = createTerminalHandler(harness.env, harness.dependencies)
  const response = await handler.fetch(
    seed.request(terminalPaths.socket(seed.orgId, seed.workspaceId), {
      headers: { Upgrade: 'websocket' },
    }),
  )
  expect(response.status).toBe(400)
  expect(harness.requests).toHaveLength(0)
})
