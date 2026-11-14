import { expect, it } from 'vitest'

import { TEST_TIME } from '../test-support/harness'
import { requireFeatureResult } from '../features/result'
import { setupBackendTests } from './backend-test-hooks'
import { archiveActions, archiveFixture } from './archive-test-support'
import { createWorkspace } from './workspaces'
import { FIRST_MESSAGE } from './durable-test-support'
import { ARCHIVE_STATE_KEY, type WorkspaceArchiveState } from './archive-types'
import { readWorkspace } from './workspace-data'
import { productionMembersHooks } from '../members/composition'
import { deleteOrg } from '../members/deletion'
import { restoreOrg } from '../members/restore'
import { cleanupDeletedOrgs } from '../members/cleanup'
import type { NativeCommitView } from '../test-support/native-commit'
import { boatRoute } from '../sandbox/routes'
import { computerRecords } from './computer-ledger.test-support'

const fixtureForTest = setupBackendTests()

it('finishes Archive after a provider confirms the retained computer is missing and refuses Restore', async () => {
  const fixture = fixtureForTest()
  const saved = await archiveFixture(fixture)
  const route = boatRoute({ operation: 'get', sandboxId: saved.sandboxId })
  const fetch = fixture.runtime.dependencies.fetch
  let missingReads = 0
  fixture.runtime.dependencies.fetch = async (request) => {
    if (
      request.method === route.method &&
      new URL(request.url).pathname.endsWith(route.path)
    ) {
      missingReads++
      return Response.json({ ok: false, code: 'not_found' }, { status: 404 })
    }
    return fetch(request)
  }
  const response = await saved.archive()
  expect(response.workspace.restoreUntil).toBeNull()
  expect(await computerRecords(fixture.runtime.env.DB)).toMatchObject([
    {
      sandboxId: saved.sandboxId,
      providerAccount: 'boat',
      deletedAt: TEST_TIME,
      cleanupPending: 0,
    },
  ])
  expect(
    await readWorkspace(fixture.runtime.env.DB, fixture.org.id, saved.id),
  ).toMatchObject({ sandboxId: null, state: 'archived' })
  expect(await saved.restore()).toMatchObject({
    ok: false,
    error: { status: 409, code: 'workspace_restore_unavailable' },
  })
  expect(saved.actor.events.at(-1)?.event).toMatchObject({
    type: 'workspace.updated',
    workspace: { restoreUntil: null },
  })
  expect(
    await saved.actor.storage.get('alarm:lifecycle:archive'),
  ).toBeUndefined()
  expect(missingReads).toBe(1)
  expect(fixture.boat.deletedIds).toEqual([])
})

it.each(['beforeCommit', 'afterCommit'] as const)(
  'recovers interrupted Archive initialization at %s and an uncertain allocation before resuming unfinished creation',
  async (boundary) => {
    const fixture = fixtureForTest()
    fixture.boat.lostCreateReplies = 1
    const created = await fixture.run(() =>
      createWorkspace(fixture.runtime, fixture.org.id, fixture.user, {
        repositoryId: fixture.repositoryId,
        firstMessage: FIRST_MESSAGE,
      }),
    )
    const id = created.workspace.id
    const actor = fixture.actors.get(id)
    const start = fixture.starts.get(id)
    if (!actor || !start) throw new Error('Missing interrupted create')
    await start.advance()
    const allocation = await start.job()
    if (!allocation) throw new Error('Missing uncertain allocation')
    expect(await computerRecords(fixture.runtime.env.DB)).toMatchObject([
      {
        allocationKey: allocation.attempt,
        sandboxId: null,
        providerAccount: allocation.providerAccount,
        ownerUserId: fixture.user.id,
        purpose: 'workspace',
        purposeId: id,
        deletedAt: null,
      },
    ])
    expect(
      (await readWorkspace(fixture.runtime.env.DB, fixture.org.id, id))
        .sandboxId,
    ).toBeNull()
    const actions = archiveActions(fixture, id, actor)
    let interrupted = false
    await actor.native.configure({
      hooks: {
        [boundary]: async (commit: NativeCommitView) => {
          if (interrupted || !commit.writes.includes(ARCHIVE_STATE_KEY)) return
          const state =
            await commit.storage.get<WorkspaceArchiveState>(ARCHIVE_STATE_KEY)
          if (state?.phase !== 'initializing') return
          interrupted = true
          throw new Error('Archive checkpoint interrupted')
        },
      },
    })
    await expect(actions.archive()).rejects.toThrow(
      'Archive checkpoint interrupted',
    )
    expect((await start.job())?.phase).toBe('machine')
    await actor.native.configure({})
    await actor.restart()
    await fixture.advanceTo(TEST_TIME + 30_000, id)
    expect(await start.job()).toBeUndefined()
    expect(await actor.endpoint().waitCreationLifecycle()).toMatchObject({
      ok: false,
      error: { code: 'workspace_start_stopped' },
    })
    expect(fixture.boat.deletedIds).toEqual([])
    expect(fixture.boat.commands).toEqual([])
    expect(
      await readWorkspace(fixture.runtime.env.DB, fixture.org.id, id),
    ).toMatchObject({ sandboxId: 'bx_1', state: 'archived' })
    expect(await computerRecords(fixture.runtime.env.DB)).toMatchObject([
      {
        allocationKey: allocation.attempt,
        sandboxId: 'bx_1',
        providerAccount: allocation.providerAccount,
        ownerUserId: fixture.user.id,
        purpose: 'workspace',
        purposeId: id,
        deletedAt: null,
      },
    ])
    requireFeatureResult(await actions.restore())
    expect(
      requireFeatureResult(
        await actor.native.api.lifecycleRpc.resumeMemberCreation(
          fixture.org.id,
          id,
          fixture.user.id,
        ),
      ),
    ).toBe(true)
    for (let step = 0; step < 20 && (await start.job()); step++) {
      if ((await start.job())?.phase === 'runner')
        await actor.endpoint().reportRunnerLifecycle({ type: 'runner.ready' })
      await start.advance()
    }
    expect(await start.wait()).toEqual({ ok: true })
    expect(fixture.boat.starts).toHaveLength(2)
    expect(fixture.boat.deletedIds).toEqual([])
    expect(
      fixture.boat.commands.some((command) => command.includes('git fetch')),
    ).toBe(true)
  },
)

it('restores archive timers after Org Restore and purges archived disks with Delete org', async () => {
  const fixture = fixtureForTest()
  const saved = await archiveFixture(fixture, true)
  await fixture.setTime(TEST_TIME + 12 * 86_400_000)
  const archived = await saved.archive()
  const { env, dependencies } = fixture.runtime
  const hooks = productionMembersHooks(env, dependencies)
  await deleteOrg(
    env,
    fixture.org.id,
    fixture.user.id,
    fixture.org.name,
    dependencies,
    hooks,
  )
  expect(await saved.actor.storage.getAlarm()).toBeNull()
  expect(
    await env.DB.prepare('SELECT stopped_at FROM workspaces WHERE id = ?')
      .bind(saved.id)
      .first('stopped_at'),
  ).toBe(TEST_TIME)
  await fixture.setTime(TEST_TIME + 13 * 86_400_000)
  expect(await cleanupDeletedOrgs(env, dependencies, hooks)).toEqual({
    purged: [],
    pending: [],
  })
  expect(fixture.boat.resumeIds).toEqual([saved.sandboxId])
  await restoreOrg(env, fixture.org.id, fixture.user.id, dependencies, hooks)
  await fixture.advanceTo(TEST_TIME + 13 * 86_400_000, saved.id)
  expect(fixture.boat.resumeIds).toEqual([saved.sandboxId])
  expect(await saved.actor.storage.get('alarm:lifecycle:archive')).toBe(
    archived.workspace.restoreUntil,
  )
  await fixture.setTime(TEST_TIME + 25 * 86_400_000)
  await deleteOrg(
    env,
    fixture.org.id,
    fixture.user.id,
    fixture.org.name,
    dependencies,
    hooks,
  )
  await fixture.setTime(TEST_TIME + 26 * 86_400_000)
  expect(await cleanupDeletedOrgs(env, dependencies, hooks)).toEqual({
    purged: [],
    pending: [],
  })
  expect(fixture.boat.deletedIds).toContain(saved.sandboxId)
  expect(await computerRecords(env.DB)).toMatchObject([
    {
      sandboxId: saved.sandboxId,
      providerAccount: 'boat',
      deletedAt: TEST_TIME + 26 * 86_400_000,
      cleanupPending: 0,
    },
  ])
  await fixture.setTime(TEST_TIME + 32 * 86_400_000)
  expect(await cleanupDeletedOrgs(env, dependencies, hooks)).toEqual({
    purged: [fixture.org.id],
    pending: [],
  })
  expect(fixture.boat.deletedIds).toContain(saved.sandboxId)
})
