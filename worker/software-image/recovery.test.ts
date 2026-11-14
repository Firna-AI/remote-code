import { expect, it } from 'vitest'

import { setupBackendTests } from '../lifecycle/backend-test-hooks'
import { isRecord } from '../http'
import { SOFTWARE_RELEASE as SOFTWARE } from '../lifecycle/software-release-test-support'
import { boatRoute } from '../sandbox/routes'
import { heldOperation } from '../test-support/held-operation'
import { requestSoftwareImage } from './build'
import { softwareImages } from './data'

const fixtureForTest = setupBackendTests()
const digest = 'a'.repeat(64)
const save = boatRoute({ operation: 'saveSnapshot' })
const startCommand = boatRoute({ operation: 'startCommand', sandboxId: 'bx_1' })

function isRoute(request: Request, route: { method: string; path: string }) {
  return (
    request.method === route.method &&
    new URL(request.url).pathname.endsWith(route.path)
  )
}

it('replays a lost command start through the same journal', async () => {
  const { images, boat } = fixtureForTest()
  const fetch = images.dependencies.fetch
  let lose = true
  images.dependencies.fetch = async (request) => {
    const response = await fetch(request)
    if (lose && isRoute(request, startCommand)) {
      const body: unknown = await request.clone().json()
      if (isRecord(body) && body.detached === true) {
        lose = false
        throw new Error('Lost command start reply')
      }
    }
    return response
  }
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'building',
  )
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'ready',
  )
  const starts = boat.commandRequests.filter((command) => command.detached)
  expect(starts).toHaveLength(2)
  expect(starts[1]).toEqual(starts[0])
})

it('reads a recorded snapshot after its save reply is lost', async () => {
  const { images, boat } = fixtureForTest()
  const fetch = images.dependencies.fetch
  let saves = 0
  images.dependencies.fetch = async (request) => {
    const response = await fetch(request)
    if (isRoute(request, save)) {
      saves++
      throw new Error('Lost snapshot reply')
    }
    return response
  }
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'building',
  )
  expect((await softwareImages(images.env.DB, 'boat'))[0]).toMatchObject({
    phase: 'snapshot',
    snapshotRecorded: 1,
  })
  expect((await requestSoftwareImage(images, SOFTWARE, digest)).state).toBe(
    'ready',
  )
  expect(saves).toBe(1)
  expect(boat.deletedSnapshots).toEqual([])
})

it('fails a refused provider operation and cleans a recorded snapshot', async () => {
  const { images, boat } = fixtureForTest()
  const fetch = images.dependencies.fetch
  images.dependencies.fetch = async (request) => {
    const response = await fetch(request)
    if (isRoute(request, save))
      return Response.json(
        { code: 'forbidden', message: 'private-provider-message' },
        { status: 403 },
      )
    return response
  }
  const result = await requestSoftwareImage(images, SOFTWARE, digest)
  expect(result).toMatchObject({
    state: 'failed',
    error: 'The software image build failed.',
  })
  const image = (await softwareImages(images.env.DB, 'boat'))[0]
  expect(image).toMatchObject({
    state: 'failed',
    phase: 'done',
    sandboxId: null,
  })
  expect(boat.deletedIds).toEqual(['bx_1'])
  expect(boat.deletedSnapshots).toEqual([image.snapshotName])
  expect(JSON.stringify(result)).not.toContain('private-provider-message')
})

it('fences concurrent command polls without duplicate saved output or two active attempts', async () => {
  const { images, boat } = fixtureForTest()
  boat.commandRunning = true
  await requestSoftwareImage(images, SOFTWARE, digest)
  const held = heldOperation()
  let first = true
  boat.beforeStatus = async () => {
    if (first) {
      first = false
      await held.wait()
    }
  }
  boat.commandOutput += 'next\n'
  const earlier = requestSoftwareImage(images, SOFTWARE, digest)
  try {
    await held.entered
    const later = await requestSoftwareImage(images, SOFTWARE, digest)
    expect(later).toMatchObject({ state: 'building', output: 'next\n' })
  } finally {
    held.release()
  }
  expect(await earlier).toMatchObject({ state: 'building', output: '' })
  const imagesNow = await softwareImages(images.env.DB, 'boat')
  expect(imagesNow).toHaveLength(1)
  expect(imagesNow[0].output).toBe('installing...\nnext\n')
  expect(boat.starts).toHaveLength(1)
})

/** Answers each save and lookup of the attempt's snapshot with `status`. */
function snapshotStatus(
  images: ReturnType<typeof fixtureForTest>['images'],
  status: () => 'saving' | 'ready' | 'failed',
) {
  const fetch = images.dependencies.fetch
  images.dependencies.fetch = async (request) => {
    const response = await fetch(request)
    const [image] = await softwareImages(images.env.DB, 'boat')
    const lookup =
      image && boatRoute({ operation: 'getSnapshot', name: image.snapshotName })
    if (
      status() === 'ready' ||
      !(isRoute(request, save) || (lookup && isRoute(request, lookup)))
    )
      return response
    const body: unknown = await response.json()
    if (!isRecord(body) || !isRecord(body.snapshot))
      throw new Error('Unexpected snapshot reply')
    return Response.json({
      ...body,
      snapshot: { ...body.snapshot, status: status() },
    })
  }
}

it('publishes a software image only after its save completes', async () => {
  const { images, boat } = fixtureForTest()
  let status: 'saving' | 'ready' = 'saving'
  snapshotStatus(images, () => status)
  for (let request = 0; request < 2; request++) {
    expect(await requestSoftwareImage(images, SOFTWARE, digest)).toMatchObject({
      state: 'building',
      phase: 'snapshot',
    })
    expect((await softwareImages(images.env.DB, 'boat'))[0]).toMatchObject({
      state: 'building',
      phase: 'snapshot',
      sandboxId: 'bx_1',
    })
    expect(boat.deletedIds).toEqual([])
  }
  status = 'ready'
  expect(await requestSoftwareImage(images, SOFTWARE, digest)).toMatchObject({
    state: 'ready',
    phase: 'done',
  })
  expect(boat.deletedIds).toEqual(['bx_1'])
  expect(boat.deletedSnapshots).toEqual([])
})

it('fails at once when the provider reports a failed save', async () => {
  const { images, boat } = fixtureForTest()
  snapshotStatus(images, () => 'failed')
  expect(await requestSoftwareImage(images, SOFTWARE, digest)).toMatchObject({
    state: 'failed',
    error: 'The software image build failed.',
  })
  const [image] = await softwareImages(images.env.DB, 'boat')
  expect(image).toMatchObject({
    state: 'failed',
    phase: 'done',
    sandboxId: null,
  })
  expect(boat.deletedIds).toEqual(['bx_1'])
  expect(boat.deletedSnapshots).toEqual([image.snapshotName])
})
