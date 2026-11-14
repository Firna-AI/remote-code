import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { RunnerProtocolVersion } from '../../src/shared/generated/RunnerProtocolVersion'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import {
  CLAUDE,
  MACHINE_ORIGIN,
  WORKSPACE_ID,
} from '../chat/harness.test-support'
import { terminalEvent } from '../chat/turn-lifecycle.test-support'
import { ManualChatClock } from '../chat/chat-clock.test-support'
import { requestBodyEntry } from '../http/request-body'
import type { HttpFetch } from '../env'
import { freshCodexLogin } from '../codex-auth/renew'
import { failCodexAccessToken } from '../codex-auth/failure'
import { waitForCodexRotation } from '../codex-auth/rotation'
import type { CodexTaskOwner } from '../codex-auth/tasks'
import { fakeCodexTasks } from '../codex-auth/tasks.test-support'
import { FakeAnthropic } from '../test-support/fake-anthropic'
import { FakeOpenAI } from '../test-support/fake-openai'
import { FakeModelUpstream } from '../test-support/fake-model-upstream'
import type { TestHarness } from '../test-support/harness'
import { runningGatewayTurn } from './fixture.test-support'
import { routeModelGateway } from './route'
import { gatewayWorkspaceAllowed } from './workspace-access'

export const claudeClientHeaders = {
  'anthropic-beta': 'claude-code-20250219',
  'user-agent': 'claude-cli/2.1.318 (external, sdk-ts, agent-sdk/0.3.318)',
} as const

export function gatewayPath(agent: 'claude' | 'codex', suffix?: string) {
  return agent === 'claude'
    ? `${MACHINE_PATHS.claudeGateway}${suffix ?? '/v1/messages'}`
    : `${MACHINE_PATHS.codexGateway}${suffix ?? '/responses'}`
}

export async function gatewayHttp(
  harness: TestHarness,
  choice: AgentChoice = CLAUDE,
  kind: 'api-key' | 'token' | 'endpoint' = 'api-key',
  protocolVersion: RunnerProtocolVersion = 2,
  upstream?: HttpFetch,
  recovery: {
    wait?: (milliseconds: number) => Promise<void>
    beforeRenew?: () => Promise<void>
    beforeFailure?: () => Promise<void>
    tasks?: CodexTaskOwner
  } = {},
  endpointLogin: { secret?: string; endpoint?: string } = {},
) {
  const turn = await runningGatewayTurn(harness, choice, {
    kind,
    protocolVersion,
    ...endpointLogin,
  })
  const { fixture } = turn
  const clock = new ManualChatClock(fixture.clock.now())
  const tasks = recovery.tasks ?? fakeCodexTasks().owner
  const anthropic = new FakeAnthropic()
  const openai = new FakeOpenAI()
  const ownEndpoint = new FakeModelUpstream(
    'https://proxy.example.test:8443',
    [
      '/private/v1/messages',
      '/private/v1/messages/count_tokens',
      '/private/v1/responses',
    ],
    () => Response.json({ output: [] }),
  )
  const checks: string[] = []
  const workspaceLookups: string[] = []
  const workspaceCalls: string[] = []
  const endpoint = {
    checkTurnToken(token: string, claim?: true | 'complete') {
      checks.push(WORKSPACE_ID)
      return fixture.chat.turnTokens.check(WORKSPACE_ID, token, claim)
    },
  }
  const fetch = requestBodyEntry(async (request) => {
    const response = await routeModelGateway(request, {
      previewDomain: fixture.env.PREVIEW_DOMAIN,
      codexTasks: tasks,
      dependencies: {
        now: clock.now,
        randomToken: () => 'unused',
        scheduleGatewayCheck: clock.schedule,
        fetch:
          upstream ??
          ((request) =>
            new URL(request.url).hostname === 'proxy.example.test'
              ? ownEndpoint.fetch(request)
              : new URL(request.url).hostname === 'api.anthropic.com'
                ? anthropic.fetch(request)
                : openai.fetch(request)),
      },
      workspaceAllowed(id) {
        workspaceLookups.push(id)
        return gatewayWorkspaceAllowed(fixture.env.DB, id)
      },
      codexLogin: async (userId, failed) => {
        if (failed) await recovery.beforeRenew?.()
        return freshCodexLogin(
          fixture.env,
          userId,
          {
            now: clock.now,
            fetch: upstream ?? openai.fetch,
            wait:
              recovery.wait ?? ((milliseconds) => clock.advance(milliseconds)),
          },
          tasks,
          failed,
        )
      },
      codexLoginFailed: async (userId, failed) => {
        await recovery.beforeFailure?.()
        return failCodexAccessToken(fixture.env, userId, failed)
      },
      codexWaitForRotation: (userId, failed, pending) =>
        waitForCodexRotation(
          fixture.env,
          userId,
          failed,
          {
            now: clock.now,
            fetch: upstream ?? openai.fetch,
            wait:
              recovery.wait ?? ((milliseconds) => clock.advance(milliseconds)),
          },
          pending,
        ),
      workspace(id) {
        workspaceCalls.push(id)
        return endpoint
      },
    })
    return response ?? new Response(null, { status: 404 })
  })
  const authorization: Record<string, string> =
    kind === 'token' || choice.agent === 'codex'
      ? { Authorization: `Bearer ${turn.token}` }
      : { 'x-api-key': turn.token }
  const request = (
    path = gatewayPath(choice.agent),
    init: RequestInit = {},
  ) => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...(choice.agent === 'claude' ? claudeClientHeaders : {}),
      ...authorization,
    })
    new Headers(init.headers).forEach((value, name) => headers.set(name, value))
    return fetch(
      new Request(`${MACHINE_ORIGIN}${path}`, {
        method: 'POST',
        body: '{"model":"unfiltered-model","stream":true}',
        ...init,
        headers,
      }),
      fixture.env,
    )
  }
  return {
    ...turn,
    tasks,
    fixture: {
      ...fixture,
      clock: {
        ...fixture.clock,
        now: clock.now,
        schedule: clock.schedule,
        advance: async (milliseconds: number) => {
          await fixture.clock.advance(milliseconds)
          await clock.advance(milliseconds)
        },
      },
    },
    anthropic,
    openai,
    ownEndpoint,
    checks,
    endpoint,
    workspaceLookups,
    workspaceCalls,
    request,
    fetch: (request: Request) => fetch(request, fixture.env),
    secret:
      endpointLogin.secret ?? `secret-${fixture.member.id}-${choice.agent}`,
    async dispose() {
      await fixture.chat.closeConnections()
    },
    async finish() {
      turn.runner.emit(terminalEvent(turn.turn, 'finished'))
      await fixture.drain()
    },
  }
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

export function openModelStream() {
  let source!: ReadableStreamDefaultController<Uint8Array>
  const cancelled = deferred<unknown>()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller
    },
    cancel: cancelled.resolve,
  })
  return { body, source, cancelled: cancelled.promise }
}

export const expectedWorkspace = WORKSPACE_ID
