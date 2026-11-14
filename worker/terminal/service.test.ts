import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { createToolsHarness, type ToolsHarness } from '../previews/test-support'
import { decrypt } from '../security/crypto'
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

it('caches only the trusted current sandbox password without exposing it in startup commands', async () => {
  const seed = await harness.seed()
  const password = 'b'.repeat(64)
  const readiness = terminalStartCommand()
  expect(readiness.startsWith("sudo -n -- /bin/sh -c '")).toBe(true)
  expect(readiness).not.toContain(password)
  expect(readiness).not.toContain('printf')
  const base = harness.dependencies.fetch
  harness.dependencies.fetch = async (request) => {
    if (new URL(request.url).pathname.endsWith('/files')) {
      return Response.json({
        ok: true,
        type: 'file.read',
        success: true,
        path: new URL(request.url).searchParams.get('path'),
        size: 64,
        encoding: 'base64',
        content: btoa(password),
      })
    }
    return base(request)
  }
  await startWorkspaceTerminal(
    harness.env,
    seed.orgId,
    seed.workspaceId,
    harness.dependencies,
  )
  expect(readiness).not.toContain('cat /run/conductive-terminal/password')
  expect(readiness).toContain(
    'mount --bind /run/conductive-terminal /home/user/.conductive-terminal',
  )
  const stored = await harness.env.DB.prepare(
    'SELECT ciphertext FROM terminal_credentials WHERE workspace_id = ?',
  )
    .bind(seed.workspaceId)
    .first<{ ciphertext: string }>()
  expect(
    await decrypt(
      stored?.ciphertext ?? '',
      JSON.stringify(['terminal-password', seed.workspaceId]),
      harness.env.BOAT_KEY_ENCRYPTION_KEY,
    ),
  ).toBe(password)
})

it('refuses to cache a terminal password when the sandbox changes during its password read', async () => {
  const seed = await harness.seed()
  const base = harness.dependencies.fetch
  let change = "sandbox_id = 'bx_replacement'"
  harness.dependencies.fetch = async (request) => {
    if (new URL(request.url).pathname.endsWith('/files')) {
      await harness.env.DB.prepare(
        `UPDATE workspaces SET ${change} WHERE id = ?`,
      )
        .bind(seed.workspaceId)
        .run()
    }
    return base(request)
  }
  for (change of [
    "sandbox_id = 'bx_replacement'",
    "provider_account = 'boat-second'",
  ]) {
    await harness.env.DB.prepare(
      "UPDATE workspaces SET sandbox_id = 'bx_one', provider_account = 'boat' WHERE id = ?",
    )
      .bind(seed.workspaceId)
      .run()
    await expect(
      startWorkspaceTerminal(
        harness.env,
        seed.orgId,
        seed.workspaceId,
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(
      await harness.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM terminal_credentials',
      ).first<number>('count'),
    ).toBe(0)
  }
})
