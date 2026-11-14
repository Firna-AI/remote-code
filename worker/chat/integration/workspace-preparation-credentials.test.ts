import type { WebSocket } from 'miniflare'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { readCreated } from '../../../src/app/api/read-workspaces'
import {
  MACHINE_PATHS,
  TOOL_TURN_HEADER,
} from '../../../src/shared/agent-tools'
import { sessionPaths, sessionsPath } from '../../../src/shared/sessions'
import { workspacesPath } from '../../../src/shared/workspaces'

import { readWorkspaceToken } from '../../lifecycle/tokens'
import { saveGitHubTokens } from '../../security/github-tokens'
import { CLAUDE } from '../harness.test-support'
import { record, string } from '../inputs'
import { closeSockets } from '../adapter-sockets.test-support'
import {
  createOuterRuntime,
  OUTER_MACHINE_ORIGIN,
  outerWorkerBundle,
  type OuterRuntime,
} from './outer-runtime.test-support'
import { OUTER_ORG, OUTER_REPOSITORY } from './outer-seed.test-support'
import type { Workspace } from './preparation-entry.test-support'
import {
  driveWorkspaceStart,
  prepareWorkspaceStart,
} from './workspace-start.test-support'
import { connectShellRunner } from './shell-runner.test-support'

let bundle: string
let fixture: OuterRuntime | undefined
const sockets: WebSocket[] = []
beforeAll(async () => {
  bundle = await outerWorkerBundle(
    'worker/chat/integration/preparation-entry.test-support.ts',
  )
})
afterEach(async () => {
  await closeSockets(...sockets)
  sockets.length = 0
  await fixture?.dispose()
  fixture = undefined
})

it('keeps private repository preparation authorized after a member stops its queued first turn', async () => {
  const active = (fixture = await createOuterRuntime(bundle))
  await saveGitHubTokens(
    active.env,
    'owner',
    {
      accessToken: 'private-repository-token',
      expiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
    },
    1,
  )
  active.boat.commandRunning = true
  const createdResponse = await active.request(workspacesPath(OUTER_ORG), {
    method: 'POST',
    body: JSON.stringify({
      repositoryId: OUTER_REPOSITORY,
      firstMessage: {
        id: 'private-first-message',
        text: 'Prepare the private repository',
        choice: CLAUDE,
        attachmentIds: [],
      },
    }),
  })
  expect(createdResponse.status).toBe(201)
  const created = readCreated(await createdResponse.json())
  const bindings = await active.runtime.getBindings<{
    WORKSPACES: DurableObjectNamespace<Workspace>
  }>()
  const actor = bindings.WORKSPACES.getByName(created.workspace.id)
  while ((await actor.readStartPhase()) !== 'fetch')
    await actor.advanceStartAlarm()
  const sessions = await active.request(
    sessionsPath(OUTER_ORG, created.workspace.id),
  )
  const sessionBody = record(await sessions.json())
  if (!Array.isArray(sessionBody.sessions))
    throw new Error('The workspace sessions are missing.')
  const turnId = string(record(sessionBody.sessions[0]).activeTurnId)
  const token = await readWorkspaceToken(active.env, created.workspace.id)
  const credential = (id = turnId) =>
    active.runtime.dispatchFetch(
      `${OUTER_MACHINE_ORIGIN}${MACHINE_PATHS.gitCredential}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          [TOOL_TURN_HEADER]: id,
        },
      },
    )
  expect((await credential('another-turn')).status).toBe(409)
  const stopped = await active.request(
    sessionPaths.interrupt(OUTER_ORG, created.workspace.id, created.sessionId),
    {
      method: 'POST',
      headers: { Cookie: active.cookies.memberCookie },
      body: JSON.stringify({ turnId }),
    },
  )
  expect(stopped.status).toBe(200)
  const fetchCredential = await credential()
  expect(fetchCredential.status).toBe(200)
  expect(await fetchCredential.json()).toEqual({
    token: 'private-repository-token',
  })
  active.boat.commandRunning = false
  while ((await actor.readStartPhase()) !== 'branch')
    await actor.advanceStartAlarm()
  expect((await credential()).status).toBe(200)
  while ((await actor.readStartPhase()) !== 'startup')
    await actor.advanceStartAlarm()
  const afterPreparation = await credential()
  expect(afterPreparation.status).toBe(409)
  expect(await afterPreparation.json()).toMatchObject({
    error: { code: 'current_turn_required' },
  })
  await prepareWorkspaceStart(actor)
  const runner = await connectShellRunner(
    active,
    created.workspace.id,
    token,
    'preparation-ready-stream',
  )
  sockets.push(runner.socket)
  expect(await runner.inbox.next()).toMatchObject({ type: 'welcome' })
  runner.emit({ type: 'runner.ready' })
  expect(await runner.inbox.next()).toMatchObject({
    type: 'confirm',
    throughEventNumber: 1,
  })
  expect(
    await driveWorkspaceStart<
      Awaited<ReturnType<Workspace['waitCreationLifecycle']>>
    >(actor, actor.waitCreationLifecycle()),
  ).toEqual({ ok: true })
  expect((await credential()).status).toBe(409)
})
