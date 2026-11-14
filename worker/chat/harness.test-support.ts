import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import type {
  NewestChatHistoryResponse,
  WorkspaceEventEnvelope,
  WorkspaceSocketMessage,
} from '../../src/shared/events'
import { chatHistoryPath, workspaceEventsPath } from '../../src/shared/events'
import type { SendMessageResponse } from '../../src/shared/messages'
import {
  sessionsPath,
  sessionPaths,
  type SessionResponse,
} from '../../src/shared/sessions'
import type { RunnerConnectionRequest } from '../../src/shared/runner-transport'
import {
  TEST_ORIGIN,
  TEST_TIME,
  type TestHarness,
} from '../test-support/harness'
import { FakeRunner } from '../test-support/fake-runner'
import type { NativeStorageHooks } from '../test-support/native-storage'
import type { NativeWorkspaceOptions } from '../test-support/native-workspace-api'
import { seedChatFixture } from './fixture-seed.test-support'
import { nativeChatTransport } from './native-transport.test-support'
import type { NativeChatCallbacks } from '../test-support/native-chat-resolvers'
import type { NativeChatObservers } from '../test-support/native-chat-observers'
import type { WorkspaceChat } from './backend'
import type { ChatTransaction } from './store'
import type { BrowserPeer } from './types'
import { nativeRequestControls } from './native-request-controls.test-support'

export const CLAUDE: AgentChoice = {
  agent: 'claude',
  model: 'test-claude',
  effort: 'high',
  fast: false,
}
export const CODEX: AgentChoice = {
  agent: 'codex',
  model: 'test-codex',
  effort: 'medium',
  fast: false,
}
export const MACHINE_ORIGIN = 'https://machines.conductive.test'
export const WORKSPACE_ID = 'workspace-chat'
export const WORKSPACE_TOKEN = 'workspace-token'

export type ChatFixtureOptions = NativeChatCallbacks &
  NativeChatObservers & {
    ids?: readonly string[]
    idFallback?: string
  }

export async function createChatFixture(
  harness: TestHarness,
  overrides: ChatFixtureOptions = {},
) {
  const seeded = await seedChatFixture(harness, WORKSPACE_ID, WORKSPACE_TOKEN)
  const { org, ownerCookie } = seeded
  const options: NativeWorkspaceOptions = {
    callbacks: overrides,
    observers: overrides,
    idFallback: overrides.idFallback,
  }
  const actor = harness.native.actor(WORKSPACE_ID, options)
  await actor.configure(options)
  if (overrides.ids) await actor.api.controls.nextIds([...overrides.ids])
  const transport = nativeChatTransport(actor)
  let now = TEST_TIME
  const request = (
    path: string,
    body?: unknown,
    cookie = ownerCookie,
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    new Request(`${TEST_ORIGIN}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const fetchRequest = async (input: Request) => {
    await transport.flushInput()
    const response = await actor.fetch(input)
    await transport.drain()
    return response
  }
  const fetch = (
    path: string,
    body?: unknown,
    cookie = ownerCookie,
    method?: string,
  ) => fetchRequest(request(path, body, cookie, method))
  const createSession = async (choice = CLAUDE, cookie = ownerCookie) => {
    const response = await fetch(
      sessionsPath(org.id, WORKSPACE_ID),
      { choice },
      cookie,
    )
    if (response.status !== 201)
      throw new Error(
        `Create returned ${response.status}: ${await response.text()}`,
      )
    const result: SessionResponse = await response.json()
    return result.session
  }
  const send = async (
    sessionId: string,
    id = 'message-1',
    cookie = ownerCookie,
    choice = CLAUDE,
    text = 'Check this code',
  ) => {
    const response = await fetch(
      sessionPaths.messages(org.id, WORKSPACE_ID, sessionId),
      { id, text, choice, attachmentIds: [] },
      cookie,
    )
    if (response.status !== 202)
      throw new Error(
        `Send returned ${response.status}: ${await response.text()}`,
      )
    const result: SendMessageResponse = await response.json()
    return result
  }
  const history = async (
    sessionId: string,
  ): Promise<Extract<NewestChatHistoryResponse, { hasMore?: never }>> => {
    const events: WorkspaceEventEnvelope[] = []
    let before: number | undefined
    let through: number | undefined
    while (true) {
      const response = await fetch(
        chatHistoryPath(org.id, WORKSPACE_ID, sessionId, before, through),
      )
      if (response.status !== 200)
        throw new Error(`History returned ${response.status}`)
      const page: NewestChatHistoryResponse = await response.json()
      events.unshift(...page.events)
      through = page.throughEventNumber
      if (!page.hasMore) return { events, throughEventNumber: through }
      before = page.nextBeforeEventNumber
    }
  }
  const setStorageHooks = async (hooks: NativeStorageHooks) => {
    options.hooks = hooks
    await actor.configure(options)
  }
  return {
    ...seeded,
    actor,
    env: { ...harness.env, MACHINE_ORIGIN },
    storage: actor.api.storage,
    chat: actor.api.chat,
    sendFileCommand: async (
      ...args: Parameters<WorkspaceChat['sendFileCommand']>
    ) => {
      await transport.flushInput()
      const result = await actor.api.chat.sendFileCommand(...args)
      await transport.drain()
      return result
    },
    appendWorkspaceEvent: async (
      ...args: Parameters<WorkspaceChat['appendWorkspaceEvent']>
    ) => {
      await transport.flushInput()
      await actor.api.chat.appendWorkspaceEvent(...args)
      await transport.drain()
    },
    changeWorkspace: async <T>(
      workspaceId: string,
      work: (view: ChatTransaction) => Promise<T>,
    ) => {
      const result = await actor.api.chat.changeWorkspace(workspaceId, work)
      await transport.drain()
      return result
    },
    snapshot: actor.api.controls.snapshot,
    setStorageHooks,
    clearFaults: () => setStorageHooks({}),
    setEnvironment: async (values: Record<string, string | undefined>) => {
      options.environment = { ...options.environment, ...values }
      await actor.configure(options)
    },
    observeQueries: async (onQuery: NativeWorkspaceOptions['onQuery']) => {
      options.onQuery = onQuery
      await actor.configure(options)
    },
    failNextCommit: (boundary: 'before' | 'after', message: string) => {
      let failed = false
      return setStorageHooks({
        [boundary === 'before' ? 'beforeCommit' : 'afterCommit']: async () => {
          if (!failed) {
            failed = true
            throw new Error(message)
          }
        },
      })
    },
    request,
    fetch,
    fetchRequest,
    createSession,
    send,
    history,
    drain: transport.drain,
    disconnect: transport.disconnect,
    drainAttachments: async () => {
      try {
        await actor.api.controls.drainBackground()
      } finally {
        await transport.drain()
      }
    },
    transport: transport.transport,
    setSendRule: transport.setSendRule,
    observeOutgoing: transport.observeOutgoing,
    tab: (
      after = 0,
      onSend?: (message: WorkspaceSocketMessage) => void,
      cookie = ownerCookie,
    ) =>
      transport.tab(
        request(
          workspaceEventsPath(org.id, WORKSPACE_ID, after),
          undefined,
          cookie,
        ),
        onSend,
      ),
    openBrowser: (request: Request, peer: BrowserPeer) =>
      transport.tab(request, peer.send, peer.close),
    connect: (
      runner = new FakeRunner({ workspaceId: WORKSPACE_ID }),
      parameters: Partial<RunnerConnectionRequest> = {},
    ) =>
      transport.connect(runner, {
        url: `${MACHINE_ORIGIN}${MACHINE_PATHS.runner}`,
        workspaceToken: WORKSPACE_TOKEN,
        ...parameters,
      }),
    clock: {
      now: () => now,
      advance: async (milliseconds: number) => {
        now += milliseconds
        await actor.api.controls.setTime(now)
        await transport.pump()
      },
      scheduledCount: async () =>
        (await actor.api.controls.snapshot()).scheduledCount,
    },
    ...nativeRequestControls(actor, options, transport.drain),
    restart: async () => {
      await transport.drain()
      transport.reset()
      await actor.restart()
    },
  }
}

export type ChatFixture = Awaited<ReturnType<typeof createChatFixture>>
