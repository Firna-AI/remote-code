import { expect } from 'vitest'

import { deleteOrgPath, restoreOrgPath } from '../../src/shared/orgs'
import { workspacesPath } from '../../src/shared/workspaces'
import { CLAUDE } from '../chat/harness.test-support'
import { record, string } from '../chat/inputs'
import {
  OUTER_ORG,
  OUTER_REPOSITORY,
  OUTER_WORKSPACE,
} from '../chat/integration/outer-seed.test-support'
import { closeSockets } from '../chat/adapter-sockets.test-support'
import {
  OuterFakeRunner,
  requestRunner,
} from '../chat/integration/runner-socket.test-support'
import { readWorkspaceToken } from '../lifecycle/tokens'
import {
  featureFixture,
  featureState,
  type FeatureFixture,
} from './fixture.test-support'
import type { Workspace } from './checkpoint-entry.test-support'

export const RETAINED_CONFIGURATION = {}

export async function retainedCreationFixture(bundle: string) {
  const fixture = await featureFixture(bundle, {
    configuration: RETAINED_CONFIGURATION,
  })
  const bindings = await fixture.runtime.getBindings<{
    WORKSPACES: DurableObjectNamespace<Workspace>
  }>()
  return {
    ...fixture,
    actor: (id = OUTER_WORKSPACE) => bindings.WORKSPACES.getByName(id),
  }
}

export type RetainedCreationFixture = Awaited<
  ReturnType<typeof retainedCreationFixture>
>

export async function admitRetainedCreation(active: FeatureFixture) {
  const created = await active.request(workspacesPath(OUTER_ORG), {
    method: 'POST',
    headers: { Cookie: active.cookies.memberCookie },
    body: JSON.stringify({
      repositoryId: OUTER_REPOSITORY,
      firstMessage: {
        id: 'allocated-create-message',
        text: 'Keep this after allocation',
        choice: CLAUDE,
        attachmentIds: [],
      },
    }),
  })
  expect(created.status).toBe(201)
  const response = record(await created.json())
  return {
    id: string(record(response.workspace).id),
    sessionId: string(response.sessionId),
    branch: string(record(response.workspace).branch),
  }
}

export async function retainedCreationJob(active: FeatureFixture, id: string) {
  return record(
    featureState(await active.actor(id).inspectFeatureState()).get(
      'lifecycle:start-job',
    ),
  )
}

export async function advanceRetainedCreation(
  active: FeatureFixture,
  id: string,
  phase: 'ready' | 'fetch' | 'branch' | 'startup' | 'runner',
) {
  let job = await retainedCreationJob(active, id)
  while (job.phase !== phase) {
    await active.actor(id).advanceStartAlarm()
    job = await retainedCreationJob(active, id)
  }
  return job
}

export async function completeRetainedCreation(
  active: FeatureFixture,
  id: string,
) {
  await advanceRetainedCreation(active, id, 'runner')
  const response = await requestRunner(
    active,
    await readWorkspaceToken(active.env, id),
  )
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket)
    throw new Error('The retained creation runner socket is missing.')
  const runner = new OuterFakeRunner(socket, id)
  try {
    expect(await runner.inbox.next()).toMatchObject({ type: 'welcome' })
    runner.emit({ type: 'runner.ready' })
    expect(await runner.inbox.next()).toMatchObject({
      type: 'confirm',
      throughEventNumber: 1,
    })
    await active.actor(id).advanceStartAlarm()
    return await active.actor(id).waitCreationLifecycle()
  } finally {
    await closeSockets(socket)
  }
}

export async function deleteAndRestoreCreation(active: FeatureFixture) {
  expect(
    (
      await active.request(deleteOrgPath(OUTER_ORG), {
        method: 'POST',
        body: JSON.stringify({ name: 'Chat org' }),
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await active.request(restoreOrgPath(OUTER_ORG), {
        method: 'POST',
        body: '{}',
      })
    ).status,
  ).toBe(200)
}
