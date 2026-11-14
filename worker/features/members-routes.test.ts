import { afterEach, beforeAll, expect, it } from 'vitest'

import { deleteOrgPath, restoreOrgPath } from '../../src/shared/orgs'
import { sessionsPath } from '../../src/shared/sessions'
import { workspacePaths } from '../../src/shared/workspaces'
import { CLAUDE } from '../chat/harness.test-support'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import {
  OUTER_ORG,
  OUTER_SOFTWARE,
  OUTER_WORKSPACE,
} from '../chat/integration/outer-seed.test-support'
import {
  featureFixture,
  featureState,
  seedFeatureBuild,
  type FeatureFixture,
} from './fixture.test-support'

let bundle: string
let fixture: FeatureFixture | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle('worker/features/entry.test-support.ts')
})
afterEach(async () => {
  await fixture?.dispose()
})
const configuration = {}

it('restores maintenance without a resume and purges real chat storage through the scheduled entry', async () => {
  const active = (fixture = await featureFixture(bundle, { configuration }))
  await active.env.DB.prepare(
    "UPDATE workspaces SET sandbox_id = 'bx_members' WHERE id = ?",
  )
    .bind(OUTER_WORKSPACE)
    .run()
  const session = await active.request(
    sessionsPath(OUTER_ORG, OUTER_WORKSPACE),
    { method: 'POST', body: JSON.stringify({ choice: CLAUDE }) },
  )
  expect(session.status).toBe(201)
  const removed = await active.request(deleteOrgPath(OUTER_ORG), {
    method: 'POST',
    body: JSON.stringify({ name: 'Chat org' }),
  })
  expect(removed.status).toBe(200)
  expect(active.boat.stopIds).toEqual(['bx_members'])
  const suspended = featureState(await active.actor().inspectFeatureState())
  expect(suspended.get('members:lifecycle-fence')).toMatchObject({
    orgId: OUTER_ORG,
    mode: 'suspended',
  })
  expect([...suspended.keys()].some((key) => key.startsWith('chat:v1:'))).toBe(
    true,
  )
  const restored = await active.request(restoreOrgPath(OUTER_ORG), {
    method: 'POST',
    body: '{}',
  })
  expect(restored.status).toBe(200)
  expect(active.boat.resumeIds).toEqual([])
  const installed = featureState(await active.actor().inspectFeatureState())
  expect(installed.get('members:lifecycle-fence')).toMatchObject({
    mode: 'active',
  })
  expect(installed.get('lifecycle:state')).toMatchObject({
    state: 'stopped',
    workspaceId: OUTER_WORKSPACE,
  })
  expect(installed.get('alarm:lifecycle')).toEqual(expect.any(Number))
  expect(
    await active
      .actor()
      .suspendMemberLifecycle(
        { orgId: OUTER_ORG, generation: 1 },
        OUTER_WORKSPACE,
      ),
  ).toMatchObject({
    ok: false,
    error: { status: 409, code: 'org_cleanup_busy' },
  })
  expect(
    (
      await active.request(deleteOrgPath(OUTER_ORG), {
        method: 'POST',
        body: JSON.stringify({ name: 'Chat org' }),
      })
    ).status,
  ).toBe(200)
  await active.env.DB.prepare('UPDATE orgs SET purge_after = 0 WHERE id = ?')
    .bind(OUTER_ORG)
    .run()
  const cleanup = await active.runtime.dispatchFetch(
    `${active.env.APP_ORIGIN}/__test/scheduled`,
  )
  expect(cleanup.status).toBe(200)
  expect(
    await active.env.DB.prepare('SELECT id FROM orgs WHERE id = ?')
      .bind(OUTER_ORG)
      .first(),
  ).toBeNull()
  const purged = featureState(await active.actor().inspectFeatureState())
  expect([...purged.keys()]).toEqual(['members:lifecycle-fence'])
  expect(purged.get('members:lifecycle-fence')).toMatchObject({
    mode: 'purged',
  })
})

it('drains a held workspace start before a newer Restore activates its generation', async () => {
  const active = (fixture = await featureFixture(bundle, { configuration }))
  await active.env.DB.prepare(
    "UPDATE workspaces SET sandbox_id = 'bx_held' WHERE id = ?",
  )
    .bind(OUTER_WORKSPACE)
    .run()
  await active.actor().initializeLifecycle({
    workspaceId: OUTER_WORKSPACE,
    orgId: OUTER_ORG,
    firstMessage: {
      id: `message-${OUTER_WORKSPACE}`,
      text: 'Retain this request',
      choice: CLAUDE,
      attachmentIds: [],
    },
    firstTurn: {
      sessionId: `session-${OUTER_WORKSPACE}`,
      turnId: `turn-${OUTER_WORKSPACE}`,
      senderUserId: 'owner',
    },
  })
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  active.boat.beforeSandboxRead = async () => {
    entered()
    await held
  }
  await active.actor().lifecycleStopped()
  active.boat.states.set('bx_held', 'archived')
  const resumed = await active.request(
    workspacePaths.resume(OUTER_ORG, OUTER_WORKSPACE),
    { method: 'POST', body: '{}' },
  )
  expect(resumed.status).toBe(200)
  const startResult = active.actor().waitLifecycleStart()
  const oldAlarm = active
    .actor()
    .advanceStartAlarm()
    .then(
      () => 'completed',
      () => 'fenced',
    )
  await reached
  const deletion = active.request(deleteOrgPath(OUTER_ORG), {
    method: 'POST',
    body: JSON.stringify({ name: 'Chat org' }),
  })
  await active.actor().waitForSuspension(1)
  await active.env.DB.prepare(
    'UPDATE org_deletions SET lease_until = 0 WHERE org_id = ?',
  )
    .bind(OUTER_ORG)
    .run()
  const restoring = active.request(restoreOrgPath(OUTER_ORG), {
    method: 'POST',
    body: '{}',
  })
  await active.actor().waitForSuspension(2)
  release()
  const [, deleted, restored, stoppedStart] = await Promise.all([
    oldAlarm,
    deletion,
    restoring,
    startResult,
  ])
  expect(stoppedStart).toMatchObject({
    ok: false,
    error: { code: 'org_not_found' },
  })
  expect(deleted.status).toBe(409)
  expect(restored.status).toBe(200)
  expect(active.boat.resumeIds).toEqual([])
  const state = featureState(await active.actor().inspectFeatureState())
  expect(state.get('members:lifecycle-fence')).toMatchObject({ mode: 'active' })
  expect(state.get('lifecycle:state')).toMatchObject({
    state: 'stopped',
    runnerConnected: false,
  })
  expect(state.has('lifecycle:start-job')).toBe(false)
})

it('drains an image build in an empty org and retains its sandbox across a newer Restore', async () => {
  const active = (fixture = await featureFixture(bundle, { configuration }))
  await active.env.DB.prepare('DELETE FROM workspaces WHERE org_id = ?')
    .bind(OUTER_ORG)
    .run()
  await seedFeatureBuild(active, 'held-image-build', 'bx_held_image')
  const image = active.actor(`org-image:${OUTER_ORG}`)
  await image.seedFeatureState({
    'org-image:coordinator': {
      orgId: OUTER_ORG,
      software: OUTER_SOFTWARE,
      buildId: 'held-image-build',
      nextAt: 0,
    },
  })
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  active.boat.beforeCommand = async () => {
    entered()
    await held
  }
  const building = image.advanceStartAlarm().then(
    () => 'completed',
    () => 'fenced',
  )
  await reached
  const deletion = active.request(deleteOrgPath(OUTER_ORG), {
    method: 'POST',
    body: JSON.stringify({ name: 'Chat org' }),
  })
  await image.waitForSuspension(1)
  await active.env.DB.prepare(
    'UPDATE org_deletions SET lease_until = 0 WHERE org_id = ?',
  )
    .bind(OUTER_ORG)
    .run()
  const restoring = active.request(restoreOrgPath(OUTER_ORG), {
    method: 'POST',
    body: '{}',
  })
  await image.waitForSuspension(2)
  release()
  const [, deleted, restored] = await Promise.all([
    building,
    deletion,
    restoring,
  ])
  expect(deleted.status).toBe(409)
  expect(restored.status).toBe(200)
  expect(
    await active.env.DB.prepare(
      "SELECT state, sandbox_id AS sandboxId FROM image_builds WHERE id = 'held-image-build'",
    ).first(),
  ).toEqual({ state: 'failed', sandboxId: 'bx_held_image' })
  expect(active.boat.stopIds).toEqual(['bx_held_image'])
  expect(active.boat.deletedIds).toEqual([])
  expect(active.boat.resumeIds).toEqual([])
  expect(
    featureState(await image.inspectFeatureState()).get(
      'members:lifecycle-fence',
    ),
  ).toMatchObject({ mode: 'active' })
})
