import { afterEach, beforeAll, expect, it } from 'vitest'

import { deleteOrgPath } from '../../src/shared/orgs'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import { OUTER_ORG } from '../chat/integration/outer-seed.test-support'
import {
  featureFixture,
  featureState,
  type FeatureFixture,
} from './fixture.test-support'
import { CLAUDE } from '../chat/harness.test-support'

let bundle: string
let fixture: FeatureFixture | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle('worker/features/entry.test-support.ts')
})
afterEach(async () => {
  await fixture?.dispose()
})

it('purges a hidden failed-create draft and its retained cleanup sandbox with the org', async () => {
  const active = (fixture = await featureFixture(bundle, {
    configuration: {},
  }))
  await active.env.DB.batch([
    active.env.DB.prepare(
      "INSERT INTO workspace_creation_attempts (workspace_id, org_id, sender_user_id, first_message_id, state, created_at) VALUES ('hidden-failure', ?, 'owner', 'hidden-message', 'failed', 1)",
    ).bind(OUTER_ORG),
    active.env.DB.prepare(
      "INSERT INTO lifecycle_sandbox_cleanup (workspace_id, org_id, sandbox_id) VALUES ('hidden-failure', ?, 'bx_hidden')",
    ).bind(OUTER_ORG),
  ])
  await active.actor('hidden-failure').seedFeatureState({
    ...Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `extension:${index}`,
        { data: 'Retained workspace data' },
      ]),
    ),
    'lifecycle:failed-creation': {
      workspaceId: 'hidden-failure',
      orgId: OUTER_ORG,
      senderUserId: 'owner',
      sessionId: 'hidden-session',
      turnId: 'hidden-turn',
      error: {
        code: 'workspace_start_failed',
        message: 'The cloud computer could not start.',
        log: null,
      },
      request: {
        id: 'hidden-message',
        text: 'Keep this draft',
        choice: CLAUDE,
        attachmentIds: [],
      },
    },
    'lifecycle:cleanup': 'hidden-failure',
  })
  const deleted = await active.request(deleteOrgPath(OUTER_ORG), {
    method: 'POST',
    body: JSON.stringify({ name: 'Chat org' }),
  })
  expect(deleted.status).toBe(200)
  expect(active.boat.stopIds).toEqual(['bx_hidden'])
  expect(active.boat.deletedIds).toEqual([])
  await active.env.DB.prepare('UPDATE orgs SET purge_after = 0 WHERE id = ?')
    .bind(OUTER_ORG)
    .run()
  expect(
    (
      await active.runtime.dispatchFetch(
        `${active.env.APP_ORIGIN}/__test/scheduled`,
      )
    ).status,
  ).toBe(200)
  expect(active.boat.deletedIds).toEqual(['bx_hidden'])
  expect([
    ...featureState(
      await active.actor('hidden-failure').inspectFeatureState(),
    ).keys(),
  ]).toEqual(['members:lifecycle-fence'])
  expect(
    await active.env.DB.prepare(
      "SELECT workspace_id FROM workspace_creation_attempts WHERE workspace_id = 'hidden-failure'",
    ).first(),
  ).toBeNull()
  expect(
    await active.actor('hidden-failure').lateSummaryOutcome(),
  ).toMatchObject({
    ok: false,
    error: { status: 409, code: 'org_cleanup_busy' },
  })
  expect(await active.actor('hidden-failure').lateAlarmOutcome()).toMatchObject(
    {
      ok: false,
      error: { status: 409, code: 'org_cleanup_busy' },
    },
  )
  expect([
    ...featureState(
      await active.actor('hidden-failure').inspectFeatureState(),
    ).keys(),
  ]).toEqual(['members:lifecycle-fence'])
})
