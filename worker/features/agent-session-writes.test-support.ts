import { mkdir, mkdtemp } from 'node:fs/promises'
import type { WebSocket } from 'miniflare'
import { expect } from 'vitest'

import { sessionsPath, sessionPaths } from '../../src/shared/sessions'
import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import { CLAUDE } from '../chat/harness.test-support'
import { record, string } from '../chat/inputs'
import { closeSockets } from '../chat/adapter-sockets.test-support'
import {
  createOuterRuntime,
  OUTER_MACHINE_ORIGIN,
} from '../chat/integration/outer-runtime.test-support'
import { seedShellWorkspaceRuntime } from '../chat/integration/shell-api.test-support'
import {
  OUTER_ORG,
  OUTER_WORKSPACE,
  OUTER_TOKEN,
} from '../chat/integration/outer-seed.test-support'
import {
  requestRunner,
  OuterFakeRunner,
} from '../chat/integration/runner-socket.test-support'
import type { Workspace } from './entry.test-support'

export async function agentWriteFixture(
  bundle: string,
  options: Parameters<typeof createOuterRuntime>[1] = {},
) {
  const directory = '.context/agent-session-tools/evidence/m4-runtimes/'
  await mkdir(directory, { recursive: true })
  const active = await createOuterRuntime(bundle, {
    ...options,
    persistencePath: await mkdtemp(directory + 'case-'),
    configuration: {
      CONDUCTIVE_DEFAULT_CHOICE: JSON.stringify(CLAUDE),
      CONDUCTIVE_MODELS: JSON.stringify([
        { ...CLAUDE, label: 'Test Claude', efforts: ['high', 'max'] },
      ]),
      ...options.configuration,
    },
  })
  await seedShellWorkspaceRuntime(active)
  const sockets: WebSocket[] = []
  const actor = async (id = OUTER_WORKSPACE) =>
    (
      await active.runtime.getBindings<{
        WORKSPACES: DurableObjectNamespace<Workspace>
      }>()
    ).WORKSPACES.getByName(id)
  const createSession = async (
    id = OUTER_WORKSPACE,
    cookie = active.cookies.memberCookie,
  ) => {
    const response = await active.request(sessionsPath(OUTER_ORG, id), {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ choice: CLAUDE }),
    })
    expect(response.status).toBe(201)
    return string(record(record(await response.json()).session).id)
  }
  const connect = async (id = OUTER_WORKSPACE, token = OUTER_TOKEN) => {
    const response = await requestRunner(active, token)
    if (!response.webSocket) throw new Error('The runner socket is missing.')
    sockets.push(response.webSocket)
    const runner = new OuterFakeRunner(response.webSocket, id)
    await runner.inbox.next()
    runner.emit({ type: 'runner.ready' })
    await runner.inbox.next()
    return runner
  }
  const start = async (
    id: string,
    sessionId: string,
    runner: OuterFakeRunner,
    userId: string,
    cookie: string,
  ) => {
    const messageId = `${userId}-starting-message`
    const response = await active.request(
      sessionPaths.messages(OUTER_ORG, id, sessionId),
      {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({
          id: messageId,
          text: 'Start this turn',
          choice: CLAUDE,
          attachmentIds: [],
        }),
      },
    )
    expect(response.status).toBe(202)
    const command = record(await runner.inbox.next())
    expect(command.type).toBe('turn')
    const turnId = string(command.turnId)
    runner.emit({
      type: 'turn.started',
      sessionId,
      turnId,
      senderId: userId,
      choice: CLAUDE,
      startedAt: 1,
      messageIds: [messageId],
    })
    await runner.inbox.next()
    return turnId
  }
  const sourceSessionId = await createSession()
  const sourceRunner = await connect()
  const sourceTurnId = await start(
    OUTER_WORKSPACE,
    sourceSessionId,
    sourceRunner,
    'member',
    active.cookies.memberCookie,
  )
  const post = (
    path: string,
    body: unknown,
    turnId: string | null = sourceTurnId,
  ) =>
    active.runtime.dispatchFetch(`${OUTER_MACHINE_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OUTER_TOKEN}`,
        'Content-Type': 'application/json',
        ...(turnId !== null && { [TOOL_TURN_HEADER]: turnId }),
      },
      body: JSON.stringify(body),
    })
  return {
    ...active,
    get runtime() {
      return active.runtime
    },
    actor,
    createSession,
    connect,
    start,
    post,
    sourceSessionId,
    sourceRunner,
    sourceTurnId,
    dispose: async () => {
      await closeSockets(...sockets)
      await active.dispose()
    },
  }
}

export type AgentWriteFixture = Awaited<ReturnType<typeof agentWriteFixture>>
