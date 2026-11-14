import { expect, it } from 'vitest'

import { setupBackendTests } from '../lifecycle/backend-test-hooks'
import { SOFTWARE_RELEASE as SOFTWARE } from '../lifecycle/software-release-test-support'
import { SAVED_IMAGE_NAME } from '../lifecycle/image-names'
import { requestSoftwareImage } from './build'
import { softwareImages } from './data'

const fixtureForTest = setupBackendTests()
const digest = 'a'.repeat(64)

it('resumes commands with saved offsets, publishes once, and creates a secret-free sandbox', async () => {
  const { images, boat } = fixtureForTest()
  boat.commandRunning = true
  boat.commandOutput = 'first\n'
  const first = await requestSoftwareImage(images, SOFTWARE, digest)
  expect(first.state).toBe('building')
  expect(first.output).toBe('first\n')
  expect(boat.starts).toHaveLength(1)
  expect(boat.starts[0]).toMatchObject({ noEnv: true, ttlSeconds: 1800 })
  expect(boat.starts[0].env).toEqual({})
  expect(boat.starts[0]).not.toHaveProperty('from')
  expect(boat.starts[0].labels).not.toHaveProperty('org')
  const attempt = (await softwareImages(images.env.DB, 'boat'))[0]
  expect(attempt.snapshotName).toMatch(SAVED_IMAGE_NAME)
  expect(boat.starts[0].name).toBe(`software-image-${attempt.id}`)
  expect(attempt).toMatchObject({
    phase: 'software',
    stdoutOffset: 6,
    output: 'first\n',
  })
  boat.commandOutput += 'last\n'
  boat.commandRunning = false
  const ready = await requestSoftwareImage(images, SOFTWARE, digest)
  expect(ready).toMatchObject({
    state: 'ready',
    phase: 'done',
    output: 'last\n',
  })
  expect(boat.statusRequests.at(-1)?.stdoutOffset).toBe(6)
  expect(boat.commands.at(-1)).toBe("rm -rf -- '/tmp/conductive-lifecycle'")
  expect(boat.deletedIds).toEqual(['bx_1'])
  expect(boat.deadlineIds).toContain('bx_1')
  expect(await requestSoftwareImage(images, SOFTWARE, digest)).toMatchObject({
    state: 'ready',
    output: '',
  })
  expect(boat.starts).toHaveLength(1)
})

it('keeps failed output within 64 KiB and retries only for a new deploy token digest', async () => {
  const { images, boat } = fixtureForTest()
  boat.commandExitCode = 1
  boat.commandOutput = '😀'.repeat(20 * 1024) + 'end!\n'
  const failed = await requestSoftwareImage(images, SOFTWARE, digest)
  expect(failed.state).toBe('failed')
  expect(failed.error).toBe('The software image build failed.')
  expect(
    new TextEncoder().encode(failed.keptOutput).length,
  ).toBeLessThanOrEqual(64 * 1024)
  expect(failed.keptOutput).toMatch(/😀end!\n$/)
  expect(failed.keptOutput).not.toContain('�')
  expect(boat.deletedIds).toEqual(['bx_1'])
  expect(await requestSoftwareImage(images, SOFTWARE, digest)).toMatchObject({
    state: 'failed',
    keptOutput: failed.keptOutput,
  })
  expect(boat.starts).toHaveLength(1)
  boat.commandExitCode = 0
  expect(
    (await requestSoftwareImage(images, SOFTWARE, 'b'.repeat(64))).state,
  ).toBe('ready')
  expect(boat.starts).toHaveLength(2)
})

it('replaces an unfinished version and cleans its sandbox', async () => {
  const { images, boat } = fixtureForTest()
  boat.commandRunning = true
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'building',
  )
  boat.commandRunning = false
  const next = { ...SOFTWARE, sha256: 'b'.repeat(64) }
  expect((await requestSoftwareImage(images, next, 'c'.repeat(64))).state).toBe(
    'ready',
  )
  const attempts = await softwareImages(images.env.DB, 'boat')
  expect(attempts.map((image) => image.state)).toEqual(['ready', 'failed'])
  expect(attempts[1].error).toBe(
    'The software image build was replaced by another software version.',
  )
  expect(boat.deletedIds).toEqual(['bx_1', 'bx_2'])
})

it('keeps a transient provider error and recovers an uncertain allocation with the same request', async () => {
  const { images, boat } = fixtureForTest()
  boat.lostCreateReplies = 1
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'building',
  )
  expect((await softwareImages(images.env.DB, 'boat'))[0]).toMatchObject({
    phase: 'allocating',
    sandboxId: null,
  })
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'ready',
  )
  expect(boat.starts).toHaveLength(2)
  expect(boat.starts[1]).toEqual(boat.starts[0])
  expect(boat.deletedIds).toEqual(['bx_1'])
})
