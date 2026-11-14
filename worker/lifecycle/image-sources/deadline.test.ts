import { generateKeyPairSync } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { createHarness, type TestHarness } from '../../test-support/harness'
import { advanceImageBuild } from '../image-builds'
import { readBuild } from '../build-data'
import { readOrgImage } from '../org-image-data'
import { nativeImageRuntime } from './image-runtime-test-support'
import { localSourceFixture } from './local-source-test-support'
import { readSourceJob } from './source-data'

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString()
let harness: TestHarness
beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
})
afterAll(async () => {
  await harness.dispose()
})

function deferred() {
  let resolve: () => void = () => {
    throw new Error('Not initialized')
  }
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('returns each alarm while native Git runs and renews the builder before allowing install after revocation', async () => {
  const fixture = await localSourceFixture(harness, privateKey)
  const held = deferred()
  const release = deferred()
  try {
    const { runtime, boat } = await nativeImageRuntime(fixture)
    fixture.access.beforeClaim = async () => {
      held.resolve()
      await release.promise
    }
    const advance = () =>
      advanceImageBuild(runtime, fixture.org.id, fixture.input.buildId)
    await advance()
    await fixture.provider.settle()
    await advance()
    await advance()
    await held.promise
    expect(await advance()).toBe(false)
    expect(await advance()).toBe(false)
    expect(boat.deadlineIds).toEqual(
      Array.from({ length: 5 }, () => 'builder-one'),
    )
    expect(fixture.provider.commands).toHaveLength(2)
    expect(fixture.provider.statusIds).toEqual([1, 2, 2])
    expect(fixture.access.requests.map((request) => request.method)).toEqual([
      'POST',
    ])
    expect(boat.commands).toEqual([])
    release.resolve()
    fixture.access.revokeFailures = 1
    await fixture.provider.settle()
    expect(await advance()).toBe(false)
    expect(
      (await readSourceJob(fixture.env.DB, fixture.input.buildId))?.phase,
    ).toBe('revoke')
    expect(boat.commands).toEqual([])
    expect(fixture.access.activeTokens).toHaveLength(1)
    const order: string[] = []
    boat.beforeCommand = async (command, detached) => {
      expect(fixture.access.activeTokens).toEqual([])
      expect(
        (await readSourceJob(fixture.env.DB, fixture.input.buildId))
          ?.tokenCiphertext,
      ).toBeNull()
      order.push(
        !detached
          ? 'cleanup'
          : command.includes('/tmp/conductive-install.sh')
            ? 'install'
            : 'software',
      )
    }
    let complete = false
    for (let count = 0; count < 20 && !complete; count++) {
      await fixture.provider.settle()
      complete = await advance()
    }
    expect(complete).toBe(true)
    expect(order).toEqual(['software', 'install', 'cleanup'])
    expect(
      (await readBuild(fixture.env.DB, fixture.org.id, fixture.input.buildId))
        .build.state,
    ).toBe('succeeded')
    expect(
      fixture.access.events.filter((event) =>
        ['claim', 'revoke', 'finalize'].includes(event),
      ),
    ).toEqual(['claim', 'revoke', 'finalize'])
  } finally {
    release.resolve()
    await fixture.dispose()
  }
})

it('keeps the last good image and deletes the builder after native source failure and revocation', async () => {
  const fixture = await localSourceFixture(harness, privateKey)
  try {
    const { runtime, boat } = await nativeImageRuntime(fixture)
    await fixture.env.DB.prepare(
      "INSERT INTO org_images (org_id, provider_account, image_name) VALUES (?, 'boat', 'last-good-image')",
    )
      .bind(fixture.org.id)
      .run()
    fixture.github.readFailure = 'unavailable'
    let complete = false
    for (let count = 0; count < 12 && !complete; count++) {
      await fixture.provider.settle()
      complete = await advanceImageBuild(
        runtime,
        fixture.org.id,
        fixture.input.buildId,
      )
    }
    expect(complete).toBe(true)
    expect(fixture.access.activeTokens).toEqual([])
    expect(boat.commands).toEqual([])
    expect(boat.deletedIds).toEqual(['builder-one'])
    expect(
      (await readOrgImage(fixture.env.DB, fixture.org.id))?.imageName,
    ).toBe('last-good-image')
    expect(
      (await readBuild(fixture.env.DB, fixture.org.id, fixture.input.buildId))
        .build,
    ).toMatchObject({
      state: 'failed',
      error:
        'The repositories could not load. Check the GitHub App access and try again.',
    })
  } finally {
    await fixture.dispose()
  }
})

it('revokes an active source token when provider access fails during cleanup', async () => {
  const fixture = await localSourceFixture(harness, privateKey)
  try {
    const { runtime, boat } = await nativeImageRuntime(fixture)
    const advance = () =>
      advanceImageBuild(runtime, fixture.org.id, fixture.input.buildId)
    await advance()
    await fixture.provider.settle()
    await advance()
    await advance()
    await fixture.provider.settle()
    expect(fixture.access.activeTokens).toHaveLength(1)
    const fetch = runtime.dependencies.fetch
    runtime.dependencies.fetch = (request) =>
      new URL(request.url).hostname === 'boat.dev'
        ? Promise.resolve(
            Response.json({ ok: false, code: 'unauthorized' }, { status: 401 }),
          )
        : fetch(request)
    await expect(advance()).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
    })
    expect(fixture.access.activeTokens).toEqual([])
    expect(
      await readSourceJob(fixture.env.DB, fixture.input.buildId),
    ).toBeNull()
    expect(boat.deletedIds).toEqual([])
    expect(
      (await readBuild(fixture.env.DB, fixture.org.id, fixture.input.buildId))
        .build,
    ).toMatchObject({
      state: 'failed',
      error:
        'The cloud computer image could not build. Check the log and try again.',
    })
  } finally {
    await fixture.dispose()
  }
})
