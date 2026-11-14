import { afterEach, expect, it, vi } from 'vitest'

import { createApp } from '../application'
import { setupBackendTests } from '../lifecycle/backend-test-hooks'
import { SOFTWARE_RELEASE as SOFTWARE } from '../lifecycle/software-release-test-support'
import { readBuildJob } from '../lifecycle/build-data'
import { IMAGE_BUILD_TIME_LIMIT_MS } from '../lifecycle/job-time-limit'
import { startImageBuild } from '../lifecycle/image-builds'
import { finishImageBuild } from '../lifecycle/image-test-support'
import { TEST_TIME } from '../test-support/harness'
import { requestSoftwareImage } from './build'
import { softwareImages } from './data'
import { repairSoftwareImages } from './repair'
import { seedReadySoftwareImage } from './test-support'

const fixtureForTest = setupBackendTests()
afterEach(() => vi.restoreAllMocks())
const event: ScheduledController = {
  cron: '*/15 * * * *',
  scheduledTime: 0,
  noRetry() {},
}
const digest = 'a'.repeat(64)

it('fails overdue builds from scheduled work and retries sandbox cleanup', async () => {
  const fixture = fixtureForTest()
  const { images, boat } = fixture
  boat.commandRunning = true
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'building',
  )
  await fixture.setTime(TEST_TIME + IMAGE_BUILD_TIME_LIMIT_MS)
  boat.deleteFailures = 1
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const app = createApp(images.dependencies)
  await app.scheduled(event, images.env)
  expect((await softwareImages(images.env.DB, 'boat'))[0]).toMatchObject({
    state: 'failed',
    phase: 'software',
    sandboxId: 'bx_1',
    error: 'The software image did not build within the 60-minute limit.',
  })
  expect(boat.deletedIds).toEqual([])
  await app.scheduled(event, images.env)
  expect((await softwareImages(images.env.DB, 'boat'))[0]).toMatchObject({
    state: 'failed',
    phase: 'done',
    sandboxId: null,
  })
  expect(boat.deletedIds).toEqual(['bx_1'])
  expect(warning.mock.calls).toEqual([
    [
      {
        kind: 'software_image_cleanup_failed',
        message:
          'Software image cleanup failed. It runs again at the next timer.',
      },
    ],
  ])
})

it('rejects stored commands whose version no longer matches the current code', async () => {
  const { images, boat } = fixtureForTest()
  boat.commandRunning = true
  await requestSoftwareImage(images, SOFTWARE, digest)
  await images.env.DB.prepare('UPDATE software_images SET software_json = ?')
    .bind(JSON.stringify({ ...SOFTWARE, sha256: 'b'.repeat(64) }))
    .run()
  const commands = boat.commands.length
  await createApp(images.dependencies).scheduled(event, images.env)
  expect((await softwareImages(images.env.DB, 'boat'))[0]).toMatchObject({
    state: 'failed',
    phase: 'done',
    error: 'The software image build was replaced by another software version.',
  })
  expect(boat.commands).toHaveLength(commands)
  expect(boat.deletedIds).toEqual(['bx_1'])
})

it('moves healthy unfinished commands from scheduled work', async () => {
  const { images, boat } = fixtureForTest()
  boat.commandRunning = true
  await requestSoftwareImage(images, SOFTWARE, digest)
  boat.commandRunning = false
  await createApp(images.dependencies).scheduled(event, images.env)
  expect((await softwareImages(images.env.DB, 'boat'))[0]).toMatchObject({
    state: 'ready',
    phase: 'done',
  })
  expect(boat.deletedIds).toEqual(['bx_1'])
})

it('warns and continues scheduled work when software image storage is unavailable', async () => {
  const { images } = fixtureForTest()
  const db = images.env.DB
  const failing = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'prepare') return Reflect.get(target, property, receiver)
      return (sql: string) => {
        if (sql.includes('software_images'))
          throw new Error('private-storage-error')
        return target.prepare(sql)
      }
    },
  })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(
    createApp(images.dependencies).scheduled(event, {
      ...images.env,
      DB: failing,
    }),
  ).resolves.toBeUndefined()
  expect(warning.mock.calls).toEqual([
    [
      {
        kind: 'software_image_repair_failed',
        message:
          'Software image repair failed. It runs again at the next timer.',
      },
    ],
  ])
})

it('keeps old software images pinned through job cleanup and deletes them after the job ends', async () => {
  const fixture = fixtureForTest()
  const { images, org, user, boat } = fixture
  await images.env.DB.prepare('DELETE FROM org_images WHERE org_id = ?')
    .bind(org.id)
    .run()
  const old = await seedReadySoftwareImage(images.env.DB, 'old')
  const id = await startImageBuild(images, {
    orgId: org.id,
    userId: user.id,
    kind: 'build',
    software: SOFTWARE,
  })
  await seedReadySoftwareImage(images.env.DB, 'new', {
    version: 'another',
    now: TEST_TIME + 1,
  })
  const other = await seedReadySoftwareImage(images.env.DB, 'other', {
    account: 'other-account',
  })
  await repairSoftwareImages(images)
  expect(
    (await readBuildJob(images.env.DB, org.id, id)).softwareImageName,
  ).toBe(old)
  expect(boat.deletedSnapshots).toEqual([])
  boat.deleteFailures = 1
  await expect(finishImageBuild(fixture, id)).rejects.toMatchObject({
    status: 503,
  })
  expect((await readBuildJob(images.env.DB, org.id, id)).phase).toBe('cleanup')
  await repairSoftwareImages(images)
  expect(boat.deletedSnapshots).toEqual([])
  await finishImageBuild(fixture, id)
  await repairSoftwareImages(images)
  expect(boat.deletedSnapshots).toEqual([old])
  expect(
    (await softwareImages(images.env.DB, 'boat')).map((image) => image.id),
  ).toEqual(['new'])
  expect(
    (await softwareImages(images.env.DB, 'other-account')).map(
      (image) => image.snapshotName,
    ),
  ).toEqual([other])
})
