import { expect, it } from 'vitest'

import { boatRoute } from '../sandbox/routes'
import { TEST_TIME } from '../test-support/harness'
import { setupBackendTests } from './backend-test-hooks'
import { SOFTWARE } from './backend-test-support'
import {
  finishUnscheduledBuild,
  insertBuild,
  publishBuild,
} from './build-admission-data'
import {
  assignBuildSandbox,
  assignBuildSnapshot,
  failBuild,
  readBuildHistory,
  readBuildJob,
} from './build-data'
import { advanceImageBuild, startImageBuild } from './image-builds'
import { refreshImagesForPush, runImageAlarm } from './image-timers'
import {
  SECONDARY_IMAGE_ACCOUNT,
  seedSecondaryOrgImage,
} from './org-image-account-test-support'
import { readOrgImage } from './org-image-data'
import {
  readCreationImage,
  readImageRepositories,
} from './published-image-data'
import { readSavedScript } from './saved-script'

const fixtureForTest = setupBackendTests()

it('publishes one account image without replacing another and admits only one build for the org', async () => {
  const fixture = fixtureForTest()
  const { runtime, images, org, user, repositoryId } = fixture
  const db = runtime.env.DB
  await seedSecondaryOrgImage(fixture)
  await db
    .prepare('UPDATE repositories SET default_branch = ? WHERE id = ?')
    .bind('secondary-next', repositoryId)
    .run()
  const id = await startImageBuild(
    images,
    { orgId: org.id, userId: user.id, kind: 'build', software: SOFTWARE },
    SECONDARY_IMAGE_ACCOUNT,
  )
  expect(await readBuildJob(db, org.id, id)).toMatchObject({
    providerAccount: SECONDARY_IMAGE_ACCOUNT,
    previousProviderAccount: SECONDARY_IMAGE_ACCOUNT,
    previousImageName: 'secondary-image',
  })
  expect(
    await startImageBuild(images, {
      orgId: org.id,
      userId: user.id,
      kind: 'build',
      software: SOFTWARE,
    }),
  ).toBe(id)
  expect(
    (await readBuildHistory(db, org.id)).builds
      .filter((build) => build.state === 'running')
      .map((build) => build.id),
  ).toEqual([id])
  await assignBuildSnapshot(
    db,
    id,
    'replacement-image',
    SECONDARY_IMAGE_ACCOUNT,
  )
  await publishBuild(db, await readBuildJob(db, org.id, id), TEST_TIME)
  expect(await readOrgImage(db, org.id)).toMatchObject({
    providerAccount: 'boat',
    imageName: 'last-good-image',
    imageBuildId: 'published-image',
    lastRefreshAt: null,
    nextImageRefreshAt: null,
  })
  expect(await readOrgImage(db, org.id, SECONDARY_IMAGE_ACCOUNT)).toMatchObject(
    {
      imageName: 'replacement-image',
      imageBuildId: id,
      lastRefreshAt: TEST_TIME,
      nextImageRefreshAt: TEST_TIME + 86_400_000,
    },
  )
  await expect(
    readCreationImage(db, org.id, repositoryId),
  ).resolves.toMatchObject({
    imageName: 'last-good-image',
    providerAccount: 'boat',
    repository: { defaultBranch: 'main' },
  })
  await expect(
    readCreationImage(db, org.id, repositoryId, SECONDARY_IMAGE_ACCOUNT),
  ).resolves.toMatchObject({
    imageName: 'replacement-image',
    providerAccount: SECONDARY_IMAGE_ACCOUNT,
    repository: { defaultBranch: 'secondary-next' },
  })
  expect(
    (await readImageRepositories(db, org.id)).map(
      (entry) => entry.defaultBranch,
    ),
  ).toEqual(['main'])
  expect(
    (await readImageRepositories(db, org.id, SECONDARY_IMAGE_ACCOUNT)).map(
      (entry) => entry.defaultBranch,
    ),
  ).toEqual(['secondary-next'])
  expect((await readBuildHistory(db, org.id)).currentImageBuildId).toBe(
    'published-image',
  )
})

it('retains another account current image while it finishes an older saved cleanup', async () => {
  const fixture = fixtureForTest()
  const { runtime, images, org, user, boat } = fixture
  const db = runtime.env.DB
  await seedSecondaryOrgImage(fixture)
  await insertBuild(db, {
    id: 'saved-cleanup-build',
    orgId: org.id,
    providerAccount: 'boat',
    previousProviderAccount: SECONDARY_IMAGE_ACCOUNT,
    kind: 'build',
    userId: user.id,
    settingsRevision: 1,
    installScript: readSavedScript(''),
    repositories: [],
    repositoryLocations: [],
    previousRepositoryLocations: [],
    software: SOFTWARE,
    previousImageName: 'secondary-image',
    now: TEST_TIME,
  })
  await assignBuildSandbox(db, 'saved-cleanup-build', 'saved-builder', 'boat')
  await assignBuildSnapshot(
    db,
    'saved-cleanup-build',
    'replacement-image',
    'boat',
  )
  await publishBuild(
    db,
    await readBuildJob(db, org.id, 'saved-cleanup-build'),
    TEST_TIME,
  )
  expect(await advanceImageBuild(images, org.id, 'saved-cleanup-build')).toBe(
    true,
  )
  expect(await readBuildJob(db, org.id, 'saved-cleanup-build')).toMatchObject({
    state: 'succeeded',
    phase: 'done',
    sandboxId: null,
  })
  expect(await readOrgImage(db, org.id, SECONDARY_IMAGE_ACCOUNT)).toMatchObject(
    {
      imageName: 'secondary-image',
      imageBuildId: 'secondary-image-build',
    },
  )
  const builder = boatRoute({ operation: 'delete', sandboxId: 'saved-builder' })
  expect(
    boat.server.requests
      .filter(
        (request) =>
          request.method === builder.method &&
          new URL(request.url).pathname.endsWith(builder.path),
      )
      .map((request) => request.headers.get('X-Boat-Org')),
  ).toEqual(['app-org'])
  expect(boat.deletedSnapshots).toEqual([])
})

it('keeps push admission and daily refresh times separate for each account', async () => {
  const fixture = fixtureForTest()
  const { runtime, images, org } = fixture
  const db = runtime.env.DB
  await seedSecondaryOrgImage(fixture)
  await db.batch([
    db
      .prepare(
        `UPDATE org_images SET last_refresh_at = ?, last_push_refresh_at = ?,
         pending_push_refresh_at = ?, next_image_refresh_at = ?
         WHERE org_id = ? AND provider_account = 'boat'`,
      )
      .bind(
        TEST_TIME - 100,
        TEST_TIME,
        TEST_TIME + 9_000,
        TEST_TIME + 43_200_000,
        org.id,
      ),
    db
      .prepare(
        `UPDATE org_images SET last_refresh_at = ?, last_push_refresh_at = ?,
         pending_push_refresh_at = ?, next_image_refresh_at = ?
         WHERE org_id = ? AND provider_account = ?`,
      )
      .bind(
        TEST_TIME - 200,
        TEST_TIME - 1_800_000,
        TEST_TIME - 1,
        TEST_TIME + 1_000,
        org.id,
        SECONDARY_IMAGE_ACCOUNT,
      ),
  ])
  const refreshed = await refreshImagesForPush(
    images,
    {
      githubRepositoryId: 1,
      ref: 'refs/heads/secondary-main',
      software: SOFTWARE,
    },
    SECONDARY_IMAGE_ACCOUNT,
  )
  expect(refreshed).toHaveLength(1)
  const [pushId] = refreshed
  expect(await readBuildJob(db, org.id, pushId)).toMatchObject({
    kind: 'refresh',
    providerAccount: SECONDARY_IMAGE_ACCOUNT,
    previousProviderAccount: SECONDARY_IMAGE_ACCOUNT,
    previousImageName: 'secondary-image',
  })
  expect(await readOrgImage(db, org.id, SECONDARY_IMAGE_ACCOUNT)).toMatchObject(
    {
      lastRefreshAt: TEST_TIME - 200,
      lastPushRefreshAt: TEST_TIME,
      pendingPushRefreshAt: null,
      nextImageRefreshAt: TEST_TIME + 1_000,
    },
  )
  await failBuild(db, pushId, 'Refresh failed.', TEST_TIME)
  await finishUnscheduledBuild(db, pushId)
  await fixture.setTime(TEST_TIME + 1_000)
  await runImageAlarm(images, {
    orgId: org.id,
    providerAccount: SECONDARY_IMAGE_ACCOUNT,
    software: SOFTWARE,
    buildId: null,
    nextAt: TEST_TIME + 1_000,
  })
  const daily = fixture.scheduled.at(-1)
  expect(daily).toMatchObject({
    providerAccount: SECONDARY_IMAGE_ACCOUNT,
    buildId: expect.any(String),
  })
  if (!daily?.buildId) throw new Error('Missing secondary daily refresh')
  expect(await readBuildJob(db, org.id, daily.buildId)).toMatchObject({
    kind: 'refresh',
    providerAccount: SECONDARY_IMAGE_ACCOUNT,
    previousProviderAccount: SECONDARY_IMAGE_ACCOUNT,
  })
  expect(await readOrgImage(db, org.id, SECONDARY_IMAGE_ACCOUNT)).toMatchObject(
    {
      imageName: 'secondary-image',
      imageBuildId: 'secondary-image-build',
      lastRefreshAt: TEST_TIME - 200,
      lastPushRefreshAt: TEST_TIME,
      pendingPushRefreshAt: null,
      nextImageRefreshAt: TEST_TIME + 86_401_000,
    },
  )
  expect(await readOrgImage(db, org.id)).toMatchObject({
    imageName: 'last-good-image',
    imageBuildId: 'published-image',
    lastRefreshAt: TEST_TIME - 100,
    lastPushRefreshAt: TEST_TIME,
    pendingPushRefreshAt: TEST_TIME + 9_000,
    nextImageRefreshAt: TEST_TIME + 43_200_000,
  })
})
