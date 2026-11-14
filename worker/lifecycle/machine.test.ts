import { beforeAll, expect, it, vi } from 'vitest'

import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'

import { isRecord } from '../http'
import { saveGitHubTokens } from '../security/github-tokens'
import { WarningId } from '../warning-values'
import { TEST_TIME } from '../test-support/harness'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import { handleGitCredential } from './machine'
import { machineCredentialFixture } from './machine-test-support'
import { readWorkspaceToken } from './tokens'

let bundle: string
beforeAll(async () => {
  bundle = await outerWorkerBundle()
})

it('returns the trusted sender token without reading a large request body', async () => {
  const fixture = await machineCredentialFixture(bundle)
  try {
    const { runtime, user } = fixture
    const created = await fixture.create()
    await saveGitHubTokens(
      runtime.env,
      user.id,
      {
        accessToken: 'trusted-sender-token',
        expiresAt: null,
        refreshToken: null,
        refreshExpiresAt: null,
      },
      TEST_TIME,
    )
    const token = await readWorkspaceToken(runtime.env, created.workspace.id)
    const request = new Request(
      `${runtime.env.MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          [TOOL_TURN_HEADER]: created.first.turnId,
        },
        body: 'x'.repeat(2 * 1024 * 1024),
      },
    )
    const result = await handleGitCredential(request, runtime).then(
      async (response) => ({
        status: response.status,
        body: await response.json(),
      }),
      (error: unknown) => error,
    )
    expect(result).toEqual({
      status: 200,
      body: { token: 'trusted-sender-token' },
    })
    expect(request.bodyUsed).toBe(false)
  } finally {
    await fixture.dispose()
  }
})

it('gets the trusted turn sender token afresh for concurrent sessions, and refuses and logs arbitrary identities', async () => {
  const fixture = await machineCredentialFixture(bundle)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    const { runtime, org, user } = fixture
    await runtime.env.DB.batch([
      runtime.env.DB.prepare(
        'INSERT INTO users (id, github_id, github_login, created_at, updated_at) VALUES (?, 18, ?, ?, ?)',
      ).bind('second-user', 'teammate', TEST_TIME, TEST_TIME),
      runtime.env.DB.prepare(
        "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
      ).bind(org.id, 'second-user', TEST_TIME),
    ])
    const sender = {
      ...user,
      id: 'second-user',
      githubId: 18,
      githubLogin: 'teammate',
    }
    const created = await fixture.create(sender)
    expect(created.workspace.owner.id).toBe(user.id)
    expect(created.first.sender.id).toBe('second-user')
    const secondSession = await fixture.session()
    const secondTurn = await fixture.send(secondSession, 'second-message')
    const save = (id: string, accessToken: string) =>
      saveGitHubTokens(
        runtime.env,
        id,
        {
          accessToken,
          expiresAt: null,
          refreshToken: null,
          refreshExpiresAt: null,
        },
        TEST_TIME,
      )
    await save('second-user', 'sender-token-one')
    await save(user.id, 'sender-token-two')
    const token = await readWorkspaceToken(runtime.env, created.workspace.id)
    const request = (turnId: string, extra: Record<string, string> = {}) =>
      new Request(
        `${runtime.env.MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            [TOOL_TURN_HEADER]: turnId,
          },
          body: JSON.stringify(extra),
        },
      )
    const [first, second] = await Promise.all([
      handleGitCredential(request(created.first.turnId), runtime),
      handleGitCredential(request(secondTurn.turnId), runtime),
    ])
    expect(await first.json()).toEqual({ token: 'sender-token-one' })
    expect(await second.json()).toEqual({ token: 'sender-token-two' })
    expect(second.headers.get('Cache-Control')).toBe('no-store')
    const terminalRequest = () =>
      new Request(
        `${runtime.env.MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      )
    const terminal = await handleGitCredential(terminalRequest(), runtime)
    expect(await terminal.json()).toEqual({ token: 'sender-token-two' })
    await save(user.id, 'new-sender-token')
    expect(
      await (
        await handleGitCredential(request(secondTurn.turnId), runtime)
      ).json(),
    ).toEqual({ token: 'new-sender-token' })
    await fixture.finish(secondTurn)
    const replacement = await fixture.send(secondSession, 'replacement-message')
    await expect(
      handleGitCredential(request(secondTurn.turnId), runtime),
    ).rejects.toMatchObject({ status: 409, code: 'current_turn_required' })
    expect(
      await (
        await handleGitCredential(request(created.first.turnId), runtime)
      ).json(),
    ).toEqual({ token: 'sender-token-one' })
    await expect(
      handleGitCredential(
        request('unknown-turn', { userId: user.id }),
        runtime,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'current_turn_required' })
    await fixture.finish(replacement)
    await expect(
      handleGitCredential(request(replacement.turnId), runtime),
    ).rejects.toMatchObject({ status: 409, code: 'current_turn_required' })
    await fixture.finish({
      sessionId: created.first.sessionId,
      turnId: created.first.turnId,
      messageId: created.first.request.id,
    })
    const idle = await handleGitCredential(terminalRequest(), runtime)
    expect(idle.headers.get('Cache-Control')).toBe('no-store')
    expect(await idle.json()).toEqual({ token: 'new-sender-token' })
    expect(
      warn.mock.calls
        .flat()
        .filter(
          (entry) => isRecord(entry) && entry.kind === 'git_credential_failed',
        ),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        kind: 'git_credential_failed',
        message: 'A Git credential request failed.',
        workspaceId: WarningId.checked(created.workspace.id).text,
        turn: true,
        error: { kind: 'http', status: 409, code: 'current_turn_required' },
      })),
    )
  } finally {
    warn.mockRestore()
    await fixture.dispose()
  }
})
