import { afterEach, beforeAll, expect, it } from 'vitest'

import { deleteOrgPath, restoreOrgPath } from '../../src/shared/orgs'
import { chatHistoryPath } from '../../src/shared/events'
import { workspacePaths, workspacesPath } from '../../src/shared/workspaces'
import { CLAUDE } from '../chat/harness.test-support'
import { record, string } from '../chat/inputs'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import {
  OUTER_ORG,
  OUTER_SOFTWARE,
  OUTER_REPOSITORY,
} from '../chat/integration/outer-seed.test-support'
import { driveWorkspaceStart } from '../chat/integration/workspace-start.test-support'
import { seedPublishedImage } from '../lifecycle/published-image-test-support'
import { readWorkspaceToken, revokeWorkspaceToken } from '../lifecycle/tokens'
import {
  featureFixture,
  featureState,
  type FeatureFixture,
} from './fixture.test-support'
import type { Workspace } from './entry.test-support'
import { completeRetainedCreation } from './retained-creation.test-support'

let bundle: string
let fixture: FeatureFixture | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle(
    'worker/features/checkpoint-entry.test-support.ts',
  )
})
afterEach(async () => {
  await fixture?.dispose()
})

it('continues a sandbox-free admitted create only when opened after Restore, with its pinned image and original sender', async () => {
  const active = (fixture = await featureFixture(bundle, {
    configuration: {},
  }))
  const created = await active.request(workspacesPath(OUTER_ORG), {
    method: 'POST',
    headers: { Cookie: active.cookies.memberCookie },
    body: JSON.stringify({
      repositoryId: OUTER_REPOSITORY,
      firstMessage: {
        id: 'retained-create-message',
        text: 'Keep this before allocation',
        choice: CLAUDE,
        attachmentIds: [],
      },
    }),
  })
  expect(created.status).toBe(201)
  const response = record(await created.json())
  const id = string(record(response.workspace).id)
  expect(record(response.workspace).number).toBe(3)
  const sessionId = string(response.sessionId)
  const original = record(
    featureState(await active.actor(id).inspectFeatureState()).get(
      'lifecycle:start-job',
    ),
  )
  expect(original).toMatchObject({ phase: 'machine', imageName: 'outer-image' })
  const token = await readWorkspaceToken(active.env, id)
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
  expect(active.boat.starts).toEqual([])
  expect(
    await active.env.DB.prepare(
      'SELECT workspace_number_count FROM orgs WHERE id = ?',
    )
      .bind(OUTER_ORG)
      .first('workspace_number_count'),
  ).toBe(3)
  expect(
    await active.env.DB.prepare(
      'SELECT state, sandbox_id AS sandboxId FROM workspaces WHERE id = ?',
    )
      .bind(id)
      .first(),
  ).toEqual({ state: 'stopped', sandboxId: null })
  await seedPublishedImage(active.env.DB, {
    orgId: OUTER_ORG,
    buildId: 'newer-image-build',
    imageName: 'newer-image',
    repositories: [
      {
        id: OUTER_REPOSITORY,
        orgId: OUTER_ORG,
        fullName: 'owner/repository',
        defaultBranch: 'main',
      },
    ],
    software: OUTER_SOFTWARE,
    now: Date.now(),
  })
  await revokeWorkspaceToken(active.env.DB, id, Date.now())
  const resumed = await active.request(workspacePaths.resume(OUTER_ORG, id), {
    method: 'POST',
    headers: { Cookie: active.cookies.memberCookie },
    body: '{}',
  })
  expect(resumed.status).toBe(200)
  const checkpoint = record(
    featureState(await active.actor(id).inspectFeatureState()).get(
      'lifecycle:start-job',
    ),
  )
  expect(checkpoint).toMatchObject({
    kind: 'create',
    attempt: original.attempt,
    imageName: 'outer-image',
    creation: { sender: { id: 'member' } },
  })
  expect(await completeRetainedCreation(active, id)).toEqual({ ok: true })
  expect(active.boat.starts).toHaveLength(1)
  expect(active.boat.starts[0]).toMatchObject({ from: 'outer-image' })
  expect(
    active.boat.server.requests
      .find(
        (request) =>
          request.method === 'POST' &&
          new URL(request.url).pathname === '/api/v1/sandboxes',
      )
      ?.headers.get('Idempotency-Key'),
  ).toBe(original.attempt)
  expect(record(active.boat.starts[0].env).WORKSPACE_TOKEN).toBe(
    await readWorkspaceToken(active.env, id),
  )
  expect(record(active.boat.starts[0].env).WORKSPACE_TOKEN).not.toBe(token)
  const next = await active.request(workspacesPath(OUTER_ORG), {
    method: 'POST',
    body: JSON.stringify({
      repositoryId: OUTER_REPOSITORY,
      firstMessage: {
        id: 'after-restore',
        text: 'A task after Restore',
        choice: CLAUDE,
        attachmentIds: [],
      },
    }),
  })
  expect(next.status).toBe(201)
  expect(record(record(await next.json()).workspace).number).toBe(4)
  const history = await active.request(
    chatHistoryPath(OUTER_ORG, id, sessionId),
  )
  expect(history.status).toBe(200)
  expect(record(await history.json()).events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'message.accepted',
          message: expect.objectContaining({
            id: 'retained-create-message',
            text: 'Keep this before allocation',
            sender: expect.objectContaining({ id: 'member' }),
          }),
        }),
      }),
    ]),
  )
})

it('keeps the workspace and its accepted message when a retained creation loses its image pin', async () => {
  const active = (fixture = await featureFixture(bundle, {
    configuration: {},
  }))
  const created = await active.request(workspacesPath(OUTER_ORG), {
    method: 'POST',
    headers: { Cookie: active.cookies.memberCookie },
    body: JSON.stringify({
      repositoryId: OUTER_REPOSITORY,
      firstMessage: {
        id: 'missing-pin-message',
        text: 'Keep this if the pin is missing',
        choice: CLAUDE,
        attachmentIds: [],
      },
    }),
  })
  expect(created.status).toBe(201)
  const id = string(record(record(await created.json()).workspace).id)
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
  expect(active.boat.starts).toEqual([])
  await active.env.DB.prepare('DELETE FROM image_leases WHERE workspace_id = ?')
    .bind(id)
    .run()
  expect(
    (
      await active.request(workspacePaths.resume(OUTER_ORG, id), {
        method: 'POST',
        headers: { Cookie: active.cookies.memberCookie },
        body: '{}',
      })
    ).status,
  ).toBe(200)
  expect(
    await driveWorkspaceStart<
      Awaited<ReturnType<Workspace['waitCreationLifecycle']>>
    >(active.actor(id), active.actor(id).waitCreationLifecycle()),
  ).toMatchObject({ ok: false, error: { code: 'image_required' } })
  expect(await active.actor(id).waitCreationAdmission()).toMatchObject({
    ok: true,
    created: {
      first: {
        sender: { id: 'member' },
        request: {
          id: 'missing-pin-message',
          text: 'Keep this if the pin is missing',
        },
      },
    },
  })
  expect(await active.actor(id).readLifecycle()).toMatchObject({
    state: 'error',
    error: { code: 'image_required' },
  })
  expect(
    await active.env.DB.prepare('SELECT id FROM workspaces WHERE id = ?')
      .bind(id)
      .first(),
  ).toEqual({ id })
  expect(active.boat.starts).toEqual([])
})
