import { expect, it } from 'vitest'

import { deleteOrg } from '../members/deletion'
import { cleanupResources } from '../members/deletion-data'
import { membersClient } from '../members/members-test-support'
import { boatRoute } from '../sandbox/routes'
import { setupBackendTests } from './backend-test-hooks'
import { SOFTWARE } from './backend-test-support'
import { readBuildHistory, readBuildJob } from './build-data'
import { advanceImageBuild, startImageBuild } from './image-builds'
import { finishImageBuild } from './image-test-support'
import { buildSnapshotIntent } from './resource-intents'
import { savedImageName } from './image-names'

const backendFixture = setupBackendTests()

it.each([
  ['recovers', false, 'succeeded'],
  ['cleans up', true, 'failed'],
] as const)(
  '%s a saved image after a lost reply and retains its name for Delete org',
  async (_action, refuseLookup, state) => {
    const fixture = await backendFixture()
    try {
      const { images, org, user, boat, runtime, harness } = fixture
      const buildId = await startImageBuild(images, {
        orgId: org.id,
        userId: user.id,
        kind: 'build',
        software: SOFTWARE,
      })
      const save = boatRoute({ operation: 'saveSnapshot' })
      const lookup = boatRoute({
        operation: 'getSnapshot',
        name: savedImageName(buildId),
      })
      let intentAtSave: string | null = null
      const fetch = images.dependencies.fetch
      images.dependencies = {
        ...images.dependencies,
        fetch: async (request) => {
          if (
            refuseLookup &&
            request.method === lookup.method &&
            new URL(request.url).pathname.endsWith(lookup.path)
          )
            return Response.json(
              { ok: false, code: 'forbidden' },
              { status: 403 },
            )
          if (
            request.method === save.method &&
            new URL(request.url).pathname.endsWith(save.path)
          ) {
            intentAtSave = (await readBuildJob(runtime.env.DB, org.id, buildId))
              .snapshotName
            await boat.fetch(request)
            throw new Error('Lost successful snapshot reply')
          }
          return fetch(request)
        },
      }

      await expect(finishImageBuild(fixture, buildId)).resolves.toBeUndefined()

      expect(boat.deletedSnapshots).toEqual([
        refuseLookup ? savedImageName(buildId) : 'last-good-image',
      ])
      expect(intentAtSave).toBe(savedImageName(buildId))
      expect(await readBuildJob(runtime.env.DB, org.id, buildId)).toMatchObject(
        {
          state,
          phase: 'done',
          snapshotName: savedImageName(buildId),
          sandboxId: null,
        },
      )
      expect(boat.deletedIds).toEqual(['bx_1'])
      expect(
        (await readBuildHistory(runtime.env.DB, org.id)).currentImageBuildId,
      ).toBe(refuseLookup ? 'published-image' : buildId)

      await deleteOrg(
        runtime.env,
        org.id,
        user.id,
        org.name,
        runtime.dependencies,
        membersClient(harness).hooks,
      )
      expect(await cleanupResources(runtime.env.DB, org.id)).toContainEqual({
        kind: 'snapshot',
        providerAccount: 'boat',
        id: savedImageName(buildId),
        stoppedAt: null,
        removedAt: null,
      })
    } finally {
      await fixture.dispose()
    }
  },
)

it('replays an undispatched snapshot intent and waits for a racing save before publication', async () => {
  const fixture = await backendFixture()
  try {
    const { images, org, user, boat, runtime } = fixture
    const buildId = await startImageBuild(images, {
      orgId: org.id,
      userId: user.id,
      kind: 'build',
      software: SOFTWARE,
    })
    let job = await readBuildJob(runtime.env.DB, org.id, buildId)
    for (let step = 0; step < 20 && job.phase !== 'snapshot'; step++) {
      await advanceImageBuild(images, org.id, buildId)
      job = await readBuildJob(runtime.env.DB, org.id, buildId)
    }
    expect(job.phase).toBe('snapshot')
    const intent = buildSnapshotIntent(runtime.env.DB, job)
    await intent.persist(intent.input)
    const name = savedImageName(buildId)
    const save = boatRoute({ operation: 'saveSnapshot' })
    const lookup = boatRoute({ operation: 'getSnapshot', name })
    expect(
      boat.server.requests.filter(
        (request) =>
          request.method === save.method &&
          new URL(request.url).pathname.endsWith(save.path),
      ),
    ).toEqual([])
    const commandsBeforeCheckpoint = [...boat.commands]
    const operations: string[] = []
    const replayedBodies: unknown[] = []
    const recordedNames: (string | null)[] = []
    let lookups = 0
    const fetch = images.dependencies.fetch
    images.dependencies = {
      ...images.dependencies,
      fetch: async (request) => {
        const path = new URL(request.url).pathname
        if (request.method === lookup.method && path.endsWith(lookup.path)) {
          operations.push('lookup')
          return ++lookups === 1
            ? Response.json({ ok: false, code: 'not_found' }, { status: 404 })
            : Response.json({
                ok: true,
                type: 'snapshot.saved.info',
                snapshot: {
                  name,
                  sourceSandboxId: 'bx_1',
                  status: 'ready',
                },
              })
        }
        if (request.method === save.method && path.endsWith(save.path)) {
          operations.push('save')
          recordedNames.push(
            (await readBuildJob(runtime.env.DB, org.id, buildId)).snapshotName,
          )
          replayedBodies.push(await request.clone().json())
          return Response.json(
            { ok: false, code: 'save_in_progress' },
            { status: 409 },
          )
        }
        return fetch(request)
      },
    }

    await advanceImageBuild(images, org.id, buildId)

    expect(await readBuildJob(runtime.env.DB, org.id, buildId)).toMatchObject({
      state: 'running',
      phase: 'snapshot',
      snapshotName: name,
      sandboxId: 'bx_1',
    })
    expect(operations).toEqual(['lookup', 'save'])
    expect(replayedBodies).toEqual([{ sandboxId: 'bx_1', name }])
    expect(recordedNames).toEqual([name])
    expect(boat.deletedIds).toEqual([])
    expect(
      (await readBuildHistory(runtime.env.DB, org.id)).currentImageBuildId,
    ).toBe('published-image')

    await advanceImageBuild(images, org.id, buildId)
    expect(await readBuildJob(runtime.env.DB, org.id, buildId)).toMatchObject({
      state: 'running',
      phase: 'publish',
      snapshotName: name,
    })
    expect(operations).toEqual(['lookup', 'save', 'lookup'])
    expect(await advanceImageBuild(images, org.id, buildId)).toBe(true)
    expect(await readBuildJob(runtime.env.DB, org.id, buildId)).toMatchObject({
      state: 'succeeded',
      phase: 'done',
      snapshotName: name,
      sandboxId: null,
    })
    expect(
      (await readBuildHistory(runtime.env.DB, org.id)).currentImageBuildId,
    ).toBe(buildId)
    expect(boat.commands).toEqual(commandsBeforeCheckpoint)
    expect(boat.deletedIds).toEqual(['bx_1'])
    expect(boat.deletedSnapshots).toEqual(['last-good-image'])
  } finally {
    await fixture.dispose()
  }
})
