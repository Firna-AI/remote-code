import { expect, it } from 'vitest'

import { seedReadySoftwareImage } from '../software-image/test-support'
import { setupBackendTests } from './backend-test-hooks'
import { SOFTWARE } from './backend-test-support'
import { readBuild, readBuildJob } from './build-data'
import { advanceImageBuild, startImageBuild } from './image-builds'
import { finishImageBuild } from './image-test-support'

const fixtureForTest = setupBackendTests()

async function withoutOrgImage() {
  const fixture = fixtureForTest()
  await fixture.images.env.DB.prepare('DELETE FROM org_images WHERE org_id = ?')
    .bind(fixture.org.id)
    .run()
  return fixture
}

it('pins a ready software image and installs the newest release in the first build', async () => {
  const fixture = await withoutOrgImage()
  const { images, org, user, boat } = fixture
  const name = await seedReadySoftwareImage(images.env.DB)
  const id = await startImageBuild(images, {
    orgId: org.id,
    userId: user.id,
    kind: 'build',
    software: SOFTWARE,
  })
  expect(await readBuildJob(images.env.DB, org.id, id)).toMatchObject({
    softwareImageName: name,
  })
  await finishImageBuild(fixture, id)
  expect(boat.starts).toHaveLength(1)
  expect(boat.starts[0].from).toBe(name)
  expect(
    boat.commandRequests.filter((command) => command.detached),
  ).toHaveLength(2)
  const build = await readBuild(images.env.DB, org.id, id)
  expect(build.build.state).toBe('succeeded')
  const log = build.log.map((event) => event.text).join('')
  expect(log).toContain('Running the install script.')
  expect(log).toContain('Installing the cloud computer software.')
})

it.each(['missing', 'other-version', 'other-account'] as const)(
  'keeps the full first-build install with a %s software image',
  async (scenario) => {
    const fixture = await withoutOrgImage()
    const { images, org, user, boat } = fixture
    if (scenario !== 'missing')
      await seedReadySoftwareImage(
        images.env.DB,
        'unusable',
        scenario === 'other-version'
          ? { version: 'old' }
          : { account: 'another' },
      )
    const id = await startImageBuild(images, {
      orgId: org.id,
      userId: user.id,
      kind: 'build',
      software: SOFTWARE,
    })
    await finishImageBuild(fixture, id)
    expect(
      (await readBuildJob(images.env.DB, org.id, id)).softwareImageName,
    ).toBeNull()
    expect(boat.starts[0].from).toBeUndefined()
    expect(
      boat.commandRequests.filter((command) => command.detached),
    ).toHaveLength(2)
    expect(
      (await readBuild(images.env.DB, org.id, id)).log
        .map((event) => event.text)
        .join(''),
    ).toContain('Installing the cloud computer software.')
  },
)

it.each(['build', 'refresh'] as const)(
  'keeps a later %s on its org image',
  async (kind) => {
    const fixture = fixtureForTest()
    const { images, org, user, boat } = fixture
    await seedReadySoftwareImage(images.env.DB)
    const id = await startImageBuild(images, {
      orgId: org.id,
      userId: user.id,
      kind,
      software: SOFTWARE,
    })
    await advanceImageBuild(images, org.id, id)
    expect(
      (await readBuildJob(images.env.DB, org.id, id)).softwareImageName,
    ).toBeNull()
    expect(boat.starts[0].from).toBe('last-good-image')
    await finishImageBuild(fixture, id)
    expect(
      boat.commandRequests.filter((command) => command.detached),
    ).toHaveLength(kind === 'build' ? 2 : 1)
  },
)
