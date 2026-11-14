import { expect, it } from 'vitest'

import { ProviderAccountError } from '../sandbox/accounts'
import { boatRoute } from '../sandbox/routes'
import { setupBackendTests } from './backend-test-hooks'
import { SOFTWARE } from './backend-test-support'
import { insertBuild, publishBuild } from './build-admission-data'
import {
  assignBuildSandbox,
  assignBuildSnapshot,
  readBuildJob,
} from './build-data'
import { recordSandboxCleanup, retrySandboxCleanup } from './cleanup'
import { resumeCompletedWorkspace } from './completed-resume-test-support'
import { FIRST_MESSAGE } from './durable-test-support'
import { advanceImageBuild } from './image-builds'
import { seedPublishedImage } from './published-image-test-support'
import { readSavedScript } from './saved-script'
import { stopWorkspaceSandbox } from './workspace-actions'
import { readWorkspace } from './workspace-data'
import { createWorkspace } from './workspaces'

const fixtureForTest = setupBackendTests()

function configureSecondary(fixture: ReturnType<typeof fixtureForTest>) {
  fixture.boat.server.addAccount({ orgId: 'second-org', apiKey: 'boat-second' })
  fixture.runtime.env.SANDBOX_PROVIDER_ACCOUNTS = {
    'boat-second': { kind: 'boat', orgId: 'second-org', apiKey: 'boat-second' },
  }
}

it('replays a lost allocation and resumes its disk through the stored secondary account', async () => {
  const fixture = fixtureForTest()
  const { runtime, org, user, repositoryId, boat } = fixture
  configureSecondary(fixture)
  await seedPublishedImage(runtime.env.DB, {
    orgId: org.id,
    buildId: 'secondary-image-build',
    imageName: 'secondary-image',
    providerAccount: 'boat-second',
    repositories: [
      {
        id: repositoryId,
        orgId: org.id,
        fullName: 'example/repository',
        defaultBranch: 'main',
      },
    ],
    software: SOFTWARE,
    now: runtime.dependencies.now(),
  })
  boat.lostCreateReplies = 1
  const created = await fixture.run(() =>
    createWorkspace(
      runtime,
      org.id,
      user,
      { repositoryId, firstMessage: FIRST_MESSAGE },
      user,
      'boat-second',
      { branch: 'feature/review', startSha: 'a'.repeat(40) },
    ),
  )
  const id = created.workspace.id
  const start = fixture.starts.get(id)
  const actor = fixture.actors.get(id)
  if (!start || !actor) throw new Error('Missing secondary start')
  await start.advance()
  expect(await start.job()).toMatchObject({
    providerAccount: 'boat-second',
    baseBranch: 'feature/review',
    startSha: 'a'.repeat(40),
    createPayloadCiphertext: expect.any(String),
  })
  await start.restart()
  for (let step = 0; step < 20 && (await start.job()); step++) {
    if ((await start.job())?.phase === 'runner')
      await actor.endpoint().reportRunnerLifecycle({ type: 'runner.ready' })
    await start.advance()
  }
  expect(await start.job()).toBeUndefined()
  expect(await start.wait()).toEqual({ ok: true })
  expect(await readWorkspace(runtime.env.DB, org.id, id)).toMatchObject({
    providerAccount: 'boat-second',
    baseBranch: 'feature/review',
    sandboxId: 'bx_1',
  })
  expect(boat.starts[0]).toMatchObject({
    env: { CONDUCTIVE_DEFAULT_BRANCH: 'feature/review' },
  })
  const create = boatRoute({ operation: 'create' })
  expect(
    boat.server.requests
      .filter(
        (request) =>
          request.method === create.method &&
          new URL(request.url).pathname.endsWith(create.path),
      )
      .map((request) => request.headers.get('X-Boat-Org')),
  ).toEqual(['second-org', 'second-org'])
  await stopWorkspaceSandbox({
    env: runtime.env,
    dependencies: runtime.dependencies,
    orgId: org.id,
    workspaceId: id,
  })
  await runtime.workspace(id).lifecycleStopped()
  expect(
    await fixture.run(() =>
      resumeCompletedWorkspace(runtime, org.id, id, user.id),
    ),
  ).toMatchObject({ workspace: { state: 'ready' } })
  expect(boat.resumeIds).toEqual(['bx_1'])
  expect(
    new Set(
      boat.server.requests.map((request) => request.headers.get('X-Boat-Org')),
    ),
  ).toEqual(new Set(['second-org']))
})

it('uses the cleanup account and retains an unknown account without a provider request', async () => {
  const fixture = fixtureForTest()
  const { runtime, org, boat } = fixture
  configureSecondary(fixture)
  await recordSandboxCleanup(runtime.env.DB, {
    workspaceId: 'secondary-cleanup',
    orgId: org.id,
    sandboxId: 'same-id',
    providerAccount: 'boat-second',
  })
  expect(
    await retrySandboxCleanup(
      runtime.env,
      runtime.dependencies,
      'secondary-cleanup',
    ),
  ).toBe(true)
  expect(
    boat.server.requests.map((request) => request.headers.get('X-Boat-Org')),
  ).toEqual(['second-org'])
  expect(
    await runtime.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM lifecycle_sandbox_cleanup',
    ).first('count'),
  ).toBe(0)
  await recordSandboxCleanup(runtime.env.DB, {
    workspaceId: 'unknown-cleanup',
    orgId: org.id,
    sandboxId: 'same-id',
    providerAccount: 'not-configured',
  })
  await expect(
    retrySandboxCleanup(runtime.env, runtime.dependencies, 'unknown-cleanup'),
  ).rejects.toBeInstanceOf(ProviderAccountError)
  expect(boat.server.requests).toHaveLength(1)
  expect(
    await runtime.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM lifecycle_sandbox_cleanup',
    ).first('count'),
  ).toBe(1)
})

it('deletes an equal-named previous image through its own account after builder cleanup', async () => {
  const fixture = fixtureForTest()
  const { runtime, images, org, user, boat } = fixture
  configureSecondary(fixture)
  await insertBuild(runtime.env.DB, {
    id: 'account-build',
    orgId: org.id,
    providerAccount: 'boat',
    previousProviderAccount: 'boat-second',
    kind: 'build',
    userId: user.id,
    settingsRevision: 1,
    installScript: readSavedScript(''),
    repositories: [],
    repositoryLocations: [],
    previousRepositoryLocations: [],
    software: SOFTWARE,
    previousImageName: 'shared-image',
    now: runtime.dependencies.now(),
  })
  await assignBuildSandbox(runtime.env.DB, 'account-build', 'same-id', 'boat')
  await assignBuildSnapshot(
    runtime.env.DB,
    'account-build',
    'shared-image',
    'boat',
  )
  await publishBuild(
    runtime.env.DB,
    await readBuildJob(runtime.env.DB, org.id, 'account-build'),
    runtime.dependencies.now(),
  )
  expect(await advanceImageBuild(images, org.id, 'account-build')).toBe(true)
  expect(
    await readBuildJob(runtime.env.DB, org.id, 'account-build'),
  ).toMatchObject({
    phase: 'done',
    sandboxId: null,
    snapshotName: 'shared-image',
    providerAccount: 'boat',
    previousProviderAccount: 'boat-second',
  })
  const builder = boatRoute({ operation: 'delete', sandboxId: 'same-id' })
  const snapshot = boatRoute({
    operation: 'deleteSnapshot',
    name: 'shared-image',
  })
  expect(
    boat.server.requests
      .filter(
        (request) =>
          request.method === builder.method &&
          new URL(request.url).pathname.endsWith(builder.path),
      )
      .map((request) => request.headers.get('X-Boat-Org')),
  ).toEqual(['app-org'])
  expect(
    boat.server.requests
      .filter(
        (request) =>
          request.method === snapshot.method &&
          new URL(request.url).pathname.endsWith(snapshot.path),
      )
      .map((request) => request.headers.get('X-Boat-Org')),
  ).toEqual(['second-org'])
})
