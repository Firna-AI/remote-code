import { expect, it } from 'vitest'
import { TEST_TIME } from '../test-support/harness'
import { lifecycleCommandBody } from './command-test-support'
import { SOFTWARE } from './backend-test-support'
import { setupBackendTests } from './backend-test-hooks'
import { readBuildJob, readBuildHistory, updateBuildJob } from './build-data'
import { startImageBuild, advanceImageBuild } from './image-builds'
import { refreshImagesForPush, runImageAlarm } from './image-timers'
import { finishImageBuild as finish } from './image-test-support'
import { joinedMember } from '../operator/suspension-test-support'
import { suspendUser } from '../operator/suspend-user'
import { readOrgImage } from './org-image-data'

const backendFixture = setupBackendTests()

it('refreshes captured repositories and revision with new software and push throttling', async () => {
  const fixture = await backendFixture()
  try {
    const { images, org, runtime, boat } = fixture
    await runtime.env.DB.batch([
      runtime.env.DB.prepare(
        'UPDATE repositories SET selected = 0 WHERE id = ?',
      ).bind(fixture.repositoryId),
      runtime.env.DB.prepare(
        'INSERT INTO repositories (id, org_id, github_repository_id, full_name, default_branch) VALUES (?, ?, 2, ?, ?)',
      ).bind('repository-two', org.id, 'example/second', 'trunk'),
      runtime.env.DB.prepare(
        'UPDATE settings SET revision = 2, install_script = ? WHERE org_id = ?',
      ).bind('echo changed-install', org.id),
    ])
    await fixture.setTime(TEST_TIME + 1_000)
    expect(
      await refreshImagesForPush(images, {
        githubRepositoryId: 2,
        ref: 'refs/heads/trunk',
        software: SOFTWARE,
      }),
    ).toEqual([])
    expect(
      await refreshImagesForPush(images, {
        githubRepositoryId: 1,
        ref: 'refs/heads/feature',
        software: SOFTWARE,
      }),
    ).toEqual([])
    const [refresh] = await refreshImagesForPush(images, {
      githubRepositoryId: 1,
      ref: 'refs/heads/main',
      software: SOFTWARE,
    })
    boat.commands.length = 0
    await finish(fixture, refresh)
    const job = await readBuildJob(runtime.env.DB, org.id, refresh)
    expect(job).toMatchObject({ kind: 'refresh', settingsRevision: 1 })
    expect(JSON.parse(job.repositoriesJson)).toEqual([
      {
        id: fixture.repositoryId,
        orgId: org.id,
        fullName: 'example/repository',
        defaultBranch: 'main',
      },
    ])
    expect(boat.commands).toHaveLength(2)
    expect(lifecycleCommandBody(boat.commands[0])).toContain(
      'update check --bootstrap',
    )
    expect(boat.commands.join('\n')).not.toContain('echo changed-install')
    expect(
      fixture.sourceCalls
        .at(-1)
        ?.repositories.map((repository) => repository.id),
    ).toEqual([fixture.repositoryId])
    expect(
      await refreshImagesForPush(images, {
        githubRepositoryId: 1,
        ref: 'refs/heads/main',
        software: SOFTWARE,
      }),
    ).toEqual([])
  } finally {
    await fixture.dispose()
  }
})

it('keeps a push pending during a build and restores the durable daily deadline', async () => {
  const fixture = backendFixture()
  const { images, org, user } = fixture
  try {
    await fixture.setTime(TEST_TIME + 1_801_000)
    const busy = await startImageBuild(images, {
      orgId: org.id,
      userId: user.id,
      kind: 'build',
      software: SOFTWARE,
    })
    await advanceImageBuild(images, org.id, busy)
    await advanceImageBuild(images, org.id, busy)
    // The timer scenario starts after software installation.
    await updateBuildJob(images.env.DB, busy, 'snapshot')
    expect(
      await refreshImagesForPush(images, {
        githubRepositoryId: 1,
        ref: 'refs/heads/main',
        software: SOFTWARE,
      }),
    ).toEqual([])
    await finish(fixture, busy)
    const pending = fixture.scheduled.at(-1)
    expect(pending).toMatchObject({
      buildId: null,
      nextAt: TEST_TIME + 1_801_000,
    })
    if (!pending) throw new Error('Missing pending push timer')
    await runImageAlarm(images, pending)
    const pendingId = fixture.scheduled.at(-1)?.buildId
    if (!pendingId) throw new Error('Missing pending push refresh')
    await finish(fixture, pendingId)
    const next = fixture.scheduled.at(-1)
    expect(next).toMatchObject({
      buildId: null,
      nextAt: TEST_TIME + 88_201_000,
    })
  } finally {
    await fixture.dispose()
  }
})

it('starts a daily refresh from its saved deadline', async () => {
  const fixture = backendFixture()
  const { runtime, org, images } = fixture
  await runtime.env.DB.prepare(
    'UPDATE org_images SET next_image_refresh_at = ? WHERE org_id = ?',
  )
    .bind(TEST_TIME + 88_201_000, org.id)
    .run()
  const next = {
    orgId: org.id,
    software: SOFTWARE,
    buildId: null,
    nextAt: TEST_TIME + 88_201_000,
  }
  await fixture.setTime(TEST_TIME + 88_201_000)
  await runImageAlarm(images, next)
  expect(
    (await readBuildHistory(runtime.env.DB, org.id)).builds[0],
  ).toMatchObject({ kind: 'refresh', state: 'running' })
  expect(fixture.scheduled.at(-1)?.buildId).not.toBe(null)
})

it('uses an active admin for automatic refreshes and leaves timers unchanged when no admin remains active', async () => {
  const fixture = backendFixture()
  const { runtime, images, org, user } = fixture
  const admin = await joinedMember(fixture)
  await runtime.env.DB.prepare(
    "UPDATE org_members SET role = 'admin', joined_at = ? WHERE org_id = ? AND user_id = ?",
  )
    .bind(TEST_TIME + 1, org.id, admin.id)
    .run()
  await suspendUser(runtime, user.githubId, user.id)
  const pushing = refreshImagesForPush(images, {
    githubRepositoryId: 1,
    ref: 'refs/heads/main',
    software: SOFTWARE,
  })
  await expect(pushing).resolves.toHaveLength(1)
  const [pushId] = await pushing
  expect(await readBuildJob(runtime.env.DB, org.id, pushId)).toMatchObject({
    startedByUserId: admin.id,
    kind: 'refresh',
  })
  // The admin scenario starts its sandbox at the snapshot phase.
  await advanceImageBuild(images, org.id, pushId)
  await updateBuildJob(runtime.env.DB, pushId, 'snapshot')
  await finish(fixture, pushId)
  const daily = fixture.scheduled.at(-1)
  if (!daily) throw new Error('Missing daily refresh schedule')
  await fixture.setTime(daily.nextAt)
  await expect(runImageAlarm(images, daily)).resolves.toBeUndefined()
  const dailyId = fixture.scheduled.at(-1)?.buildId
  if (!dailyId) throw new Error('Missing daily refresh build')
  expect(await readBuildJob(runtime.env.DB, org.id, dailyId)).toMatchObject({
    startedByUserId: admin.id,
    kind: 'refresh',
  })
  await advanceImageBuild(images, org.id, dailyId)
  await updateBuildJob(runtime.env.DB, dailyId, 'snapshot')
  await finish(fixture, dailyId)
  const noAdminAt = TEST_TIME + 172_800_000
  await fixture.setTime(noAdminAt)
  await runtime.env.DB.batch([
    runtime.env.DB.prepare(
      'UPDATE users SET suspended_at = ? WHERE id = ?',
    ).bind(noAdminAt, admin.id),
    runtime.env.DB.prepare(
      "UPDATE org_images SET pending_push_refresh_at = ? WHERE org_id = ? AND provider_account = 'boat'",
    ).bind(noAdminAt, org.id),
  ])
  await expect(
    refreshImagesForPush(images, {
      githubRepositoryId: 1,
      ref: 'refs/heads/main',
      software: SOFTWARE,
    }),
  ).resolves.toEqual([])
  const before = fixture.scheduled.length
  const pending = fixture.scheduled.at(-1)
  if (!pending) throw new Error('Missing idle image schedule')
  await expect(runImageAlarm(images, pending)).resolves.toBeUndefined()
  expect(fixture.scheduled).toHaveLength(before)
  expect(await readOrgImage(runtime.env.DB, org.id)).toMatchObject({
    lastPushRefreshAt: TEST_TIME,
    pendingPushRefreshAt: noAdminAt,
  })
  expect(
    (await readBuildHistory(runtime.env.DB, org.id)).builds.filter(
      (build) => build.state === 'running',
    ),
  ).toEqual([])
})
