import type { WebSocket } from 'miniflare'
import { expect, it } from 'vitest'
import type { RunnerHello } from '../../src/shared/generated/RunnerHello'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import { chatHistoryPath } from '../../src/shared/events'
import { sessionPaths, sessionsPath } from '../../src/shared/sessions'
import { saveAccountLogin } from '../app-api/account-data'
import {
  codexAccount,
  codexTestTokens,
} from '../model-gateway/codex-login.test-support'
import { encrypt } from '../security/crypto'
import { TEST_ORIGIN } from '../test-support/harness'
import { createAdapterRuntime } from './adapter-runtime.test-support'
import { SocketInbox } from './adapter-sockets.test-support'
import { array } from './agent-events'
import { BROWSER_TEST_NOW } from './browser-clock.test-support'
import {
  CODEX,
  MACHINE_ORIGIN,
  WORKSPACE_ID,
  WORKSPACE_TOKEN,
} from './harness.test-support'
import { record, string } from './inputs'
import { agentLoginContext } from './queries'
import { disposeRunners, runnerControls } from './runner-native.test-support'

it('delivers a Codex ChatGPT turn after the original capable runner socket hibernates and wakes', async () => {
  const { runtime, headers } = await createAdapterRuntime(
    'worker/chat/runner-entry.test-support.ts',
  )
  const controls = runnerControls(runtime, headers)
  const sockets: WebSocket[] = []
  try {
    const db = await runtime.getD1Database('DB')
    await saveAccountLogin(
      db,
      'owner',
      'codex',
      'token',
      await encrypt(
        JSON.stringify({
          ...codexTestTokens('fake-chatgpt-login-kept-in-worker'),
          expiresAt: BROWSER_TEST_NOW + 3_600_000,
        }),
        agentLoginContext('owner', 'codex'),
        btoa('e'.repeat(32)),
      ),
      BROWSER_TEST_NOW,
    )
    const response = await runtime.dispatchFetch(
      `${MACHINE_ORIGIN}${MACHINE_PATHS.runner}`,
      {
        headers: {
          Upgrade: 'websocket',
          Authorization: `Bearer ${WORKSPACE_TOKEN}`,
        },
      },
    )
    expect(response.status).toBe(101)
    const socket = response.webSocket
    if (!socket) throw new Error('The runner socket is missing.')
    sockets.push(socket)
    const inbox = new SocketInbox(socket)
    socket.accept()
    const connected = record((await controls.request('inspect')).runner)
    expect(connected).toMatchObject({
      protocolVersion: null,
      ready: false,
    })
    expect(connected.loginKinds).toBeUndefined()
    const hello: RunnerHello = {
      type: 'hello',
      protocolVersion: 2,
      workspaceId: WORKSPACE_ID,
      streamId: 'chatgpt-runner',
      loginKinds: [{ agent: 'codex', kind: 'token' }],
    }
    socket.send(JSON.stringify(hello))
    expect(await inbox.next()).toEqual({
      type: 'welcome',
      protocolVersion: 2,
      streamId: hello.streamId,
      confirmedThrough: 0,
    })
    socket.send(
      JSON.stringify({
        type: 'event',
        streamId: hello.streamId,
        eventNumber: 1,
        occurredAt: BROWSER_TEST_NOW,
        event: { type: 'runner.ready' },
      }),
    )
    expect(await inbox.next()).toEqual({
      type: 'confirm',
      streamId: hello.streamId,
      throughEventNumber: 1,
    })
    const woke = await controls.hibernate()
    const created = await runtime.dispatchFetch(
      `${TEST_ORIGIN}${sessionsPath('org', WORKSPACE_ID)}`,
      { method: 'POST', headers, body: JSON.stringify({ choice: CODEX }) },
    )
    expect(created.status).toBe(201)
    const sessionId = string(record(record(await created.json()).session).id)
    const sent = await runtime.dispatchFetch(
      `${TEST_ORIGIN}${sessionPaths.messages('org', WORKSPACE_ID, sessionId)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'chatgpt-after-wake',
          choice: CODEX,
          text: 'Continue with ChatGPT.',
          attachmentIds: [],
        }),
      },
    )
    expect(sent.status).toBe(202)
    await controls.request('settled')
    const history = await runtime.dispatchFetch(
      `${TEST_ORIGIN}${chatHistoryPath('org', WORKSPACE_ID, sessionId)}`,
      { headers },
    )
    expect(history.status).toBe(200)
    const events = array(record(await history.json()).events, record)
    expect(
      events.filter((event) => record(event.event).type === 'turn.failed'),
    ).toEqual([])
    const turn = record(await inbox.next())
    expect(turn).toMatchObject({
      type: 'turn',
      sessionId,
      message: { id: 'chatgpt-after-wake' },
      credential: {
        agent: 'codex',
        kind: 'token',
        token: expect.stringMatching(/^sk-gt1\./),
        account: codexAccount,
      },
    })
    expect(turn).not.toHaveProperty('login')
    expect(record(woke.runner).loginKinds).toEqual([
      { agent: 'codex', kind: 'token' },
    ])
    expect(woke.hello).toBe(1)
    expect(woke.ready).toBe(1)
    expect(
      inbox.received.filter((value) => record(value).type === 'welcome'),
    ).toHaveLength(1)
    expect(JSON.stringify(inbox.received)).not.toContain(
      'fake-chatgpt-login-kept-in-worker',
    )
  } finally {
    await disposeRunners(runtime, sockets)
  }
})
