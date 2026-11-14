import { beforeAll, expect, it } from 'vitest'

import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'

import { createApp } from '../application'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import { isRecord } from '../http'
import { suspendOrg } from '../operator/suspend-org'
import { expiringGitHubReply } from '../security/github-test-support'
import { saveGitHubTokens } from '../security/github-tokens'
import { machineCredentialFixture } from './machine-test-support'
import { heldOperation } from '../test-support/held-operation'
import { workspaceRuntime } from './runtime'
import { readWorkspaceToken } from './tokens'

let bundle: string
beforeAll(async () => {
  bundle = await outerWorkerBundle()
})

async function heldCredential() {
  const fixture = await machineCredentialFixture(bundle)
  try {
    const created = await fixture.create()
    const { runtime, user } = fixture
    const now = runtime.dependencies.now()
    await saveGitHubTokens(
      runtime.env,
      user.id,
      {
        accessToken: 'expired-access-token',
        expiresAt: now,
        refreshToken: 'original-refresh-token',
        refreshExpiresAt: now + 86_400_000,
      },
      now,
    )
    const refresh = heldOperation()
    const requests: Request[] = []
    const fetch = runtime.dependencies.fetch
    runtime.dependencies.fetch = async (request) => {
      if (new URL(request.url).hostname !== 'github.com') return fetch(request)
      const body: unknown = await request.clone().json()
      if (!isRecord(body) || body.grant_type !== 'refresh_token')
        throw new Error('Expected the real GitHub refresh request')
      requests.push(request.clone())
      await refresh.wait()
      return Response.json(expiringGitHubReply('refreshed-access-token'))
    }
    const app = createApp(runtime.dependencies)
    const token = await readWorkspaceToken(runtime.env, created.workspace.id)
    return {
      ...fixture,
      created,
      refresh,
      requests,
      waitForRefresh: async (pending: Promise<Response>) => {
        const state = await Promise.race([
          refresh.entered.then(() => ({ refreshing: true })),
          pending.then(async (response) => ({
            status: response.status,
            body: await response.clone().json(),
          })),
        ])
        expect(state).toEqual({ refreshing: true })
      },
      request: (bearer = token, turnId: string | null = created.first.turnId) =>
        app.fetch(
          new Request(
            `${runtime.env.MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${bearer}`,
                ...(turnId === null ? {} : { [TOOL_TURN_HEADER]: turnId }),
              },
            },
          ),
          runtime.env,
        ),
    }
  } catch (error) {
    await fixture.dispose()
    throw error
  }
}

it.each(['agent', 'terminal'] as const)(
  'refuses the %s credential whose refresh finishes after real org suspension',
  async (source) => {
    const fixture = await heldCredential()
    let pending: Promise<Response> | undefined
    try {
      const stale = await fixture.request('stale-workspace-token')
      expect(stale.status).toBe(401)
      expect(await stale.json()).toEqual({
        error: {
          code: 'workspace_token_refused',
          message: 'The workspace token is not valid.',
        },
      })
      expect(fixture.requests).toHaveLength(0)
      pending = fixture.request(
        undefined,
        source === 'terminal' ? null : fixture.created.first.turnId,
      )
      await fixture.waitForRefresh(pending)
      await suspendOrg(
        workspaceRuntime(fixture.runtime.env, fixture.runtime.dependencies),
        fixture.org.id,
        fixture.user.id,
      )
      fixture.refresh.release()
      const response = await pending
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({
        error: {
          code: 'workspace_token_refused',
          message: 'The workspace token is not valid.',
        },
      })
      expect(fixture.requests).toHaveLength(1)
    } finally {
      fixture.refresh.release()
      await Promise.allSettled(pending ? [pending] : [])
      await fixture.dispose()
    }
  },
)

it('refuses a terminal credential when its owner changes during token refresh', async () => {
  const fixture = await heldCredential()
  const pending = fixture.request(undefined, null)
  try {
    await fixture.waitForRefresh(pending)
    await fixture.runtime.env.DB.batch([
      fixture.runtime.env.DB.prepare(
        "INSERT INTO users (id, github_id, github_login, created_at, updated_at) VALUES ('new-owner', 29, 'new-owner', 1, 1)",
      ),
      fixture.runtime.env.DB.prepare(
        "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, 'new-owner', 'member', 1)",
      ).bind(fixture.org.id),
      fixture.runtime.env.DB.prepare(
        "UPDATE workspaces SET owner_user_id = 'new-owner' WHERE id = ?",
      ).bind(fixture.created.workspace.id),
    ])
    fixture.refresh.release()
    const response = await pending
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: { code: 'workspace_token_refused' },
    })
  } finally {
    fixture.refresh.release()
    await Promise.allSettled([pending])
    await fixture.dispose()
  }
})

it('refuses a Git credential whose refresh finishes after its real runner turn ends', async () => {
  const fixture = await heldCredential()
  const pending = fixture.request()
  try {
    await fixture.waitForRefresh(pending)
    await fixture.finish({
      sessionId: fixture.created.first.sessionId,
      turnId: fixture.created.first.turnId,
      messageId: fixture.created.first.request.id,
    })
    fixture.refresh.release()
    const response = await pending
    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      error: {
        code: 'current_turn_required',
        message: 'Start an agent turn to use GitHub access.',
      },
    })
    expect(fixture.requests).toHaveLength(1)
  } finally {
    fixture.refresh.release()
    await Promise.allSettled([pending])
    await fixture.dispose()
  }
})
