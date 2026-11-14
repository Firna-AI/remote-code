import type { RunnerLogin } from '../../src/shared/generated/RunnerLogin'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import type { HttpFetch } from '../env'
import type { CodexTokens } from '../codex-auth/tokens'
import { fakeCodexTasks } from '../codex-auth/tasks.test-support'
import { ManualChatClock } from '../chat/chat-clock.test-support'
import { routeModelGateway } from './route'
import { codexTokenPaths } from './paths'
import { deriveTurnToken } from './token'
import type { TurnTokenCheck } from './types'

export const accountPath = codexTokenPaths.accounts
export const modelPath = codexTokenPaths.responses

export function accounts(
  origin = 'https://regional.chatgpt.com',
  override = 'us',
) {
  return {
    accounts: [
      {
        id: 'workspace-account',
        name: 'Example workspace',
        workspace_backend_origin: origin,
        account_routing_override: override,
      },
    ],
  }
}

export async function tokenGateway(kind: 'token' | 'api-key' = 'token') {
  const login: RunnerLogin = {
    agent: 'codex',
    kind,
    secret: 'structured-login-only-in-worker',
  }
  const token = await deriveTurnToken(
    { workspaceId: 'workspace', turnId: 'turn' },
    { nonce: 'nonce', loginVersion: 1 },
    btoa('k'.repeat(32)),
    login,
  )
  const requests: Request[] = []
  const bodies: string[] = []
  const clock = new ManualChatClock(0)
  let active = true
  let workspaceAllowed = true
  let refusal: Extract<TurnTokenCheck, { ok: false }> | null = null
  let recoveryUsed = false
  let recoveryPending = false
  let credentials: CodexTokens = {
    accessToken: 'real-only-in-worker',
    refreshToken: 'refresh-only-in-worker',
    idToken: 'id-only-in-worker',
    accountId: 'workspace-account',
    expiresAt: 100_000,
  }
  const renewals: string[] = []
  const failures: string[] = []
  let reply: HttpFetch = async (request) => {
    if (new URL(request.url).pathname === accountPath)
      return Response.json(accounts())
    return Response.json({ models: [] })
  }
  const request = (path: string, init: RequestInit = {}) =>
    routeModelGateway(
      new Request(`https://machine.test${MACHINE_PATHS.codexGateway}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'chatgpt-account-id': 'workspace-account',
          ...Object.fromEntries(new Headers(init.headers)),
        },
      }),
      {
        previewDomain: undefined,
        codexTasks: fakeCodexTasks().owner,
        dependencies: {
          now: clock.now,
          randomToken: () => 'unused',
          scheduleGatewayCheck: clock.schedule,
          fetch: async (upstream) => {
            requests.push(upstream)
            bodies.push(await upstream.text())
            return reply(upstream)
          },
        },
        workspaceAllowed: async () => workspaceAllowed,
        codexLoginFailed: async (_userId, failed) => {
          failures.push(failed)
          return true
        },
        codexWaitForRotation: async (_userId, failed) =>
          credentials.accessToken !== failed
            ? { state: 'rotated', tokens: credentials }
            : { state: recoveryPending ? 'pending' : 'unchanged' },
        codexLogin: async (_userId, failed) => {
          if (failed) {
            renewals.push(failed)
            credentials = {
              ...credentials,
              accessToken: 'rotated-only-in-worker',
            }
          }
          return credentials
        },
        workspace: () => ({
          checkTurnToken: async (_token, claim) => {
            if (refusal) return refusal
            const codexRecoveryClaimed = claim === true && !recoveryUsed
            if (codexRecoveryClaimed) recoveryUsed = true
            if (codexRecoveryClaimed) recoveryPending = true
            if (claim === 'complete') recoveryPending = false
            return active
              ? {
                  ok: true,
                  login,
                  loginOwnerId: 'owner',
                  codexRecoveryClaimed,
                  codexRecoveryPending: recoveryPending,
                }
              : { ok: false, reason: 'turn_not_active' }
          },
        }),
      },
    )
  return {
    token,
    login,
    requests,
    bodies,
    renewals,
    failures,
    clock,
    request,
    forbidWorkspace: () => {
      workspaceAllowed = false
    },
    refuseToken: () => {
      refusal = { ok: false, reason: 'turn_token_invalid' }
    },
    stop: () => {
      active = false
    },
    respond: (next: HttpFetch) => {
      reply = next
    },
  }
}
