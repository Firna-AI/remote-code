import { generateKeyPairSync } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { ProviderError } from '../../sandbox/errors'
import {
  createHarness,
  TEST_TIME,
  type TestHarness,
} from '../../test-support/harness'
import { readBuildJob } from '../build-data'
import { advanceImageBuild } from '../image-builds'
import { heldOperation } from '../../test-support/held-operation'
import { nativeImageRuntime } from './image-runtime-test-support'
import { localSourceFixture } from './local-source-test-support'
import { INSTALLATION_TOKEN } from './native-github-test-support'
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

it('keeps a native source fetch after a temporary status error and resumes without repeating commands', async () => {
  const fixture = await localSourceFixture(harness, privateKey)
  const claim = heldOperation()
  try {
    const { runtime, boat } = await nativeImageRuntime(fixture)
    fixture.access.beforeClaim = claim.wait
    const advance = () =>
      advanceImageBuild(runtime, fixture.org.id, fixture.input.buildId)
    await advance()
    await fixture.provider.settle()
    await advance()
    await advance()
    await claim.entered
    const imageCheckpoint = await readBuildJob(
      fixture.env.DB,
      fixture.org.id,
      fixture.input.buildId,
    )
    const sourceCheckpoint = await readSourceJob(
      fixture.env.DB,
      fixture.input.buildId,
    )
    expect(sourceCheckpoint).toMatchObject({
      phase: 'fetch',
      processId: 2,
      stdoutOffset: 0,
      stderrOffset: 0,
    })
    fixture.provider.beforeStatus = async () => {
      throw new ProviderError('unavailable', 503)
    }
    const completeAfterFailure = await advance()
    expect(await readSourceJob(fixture.env.DB, fixture.input.buildId)).toEqual(
      sourceCheckpoint,
    )
    expect(
      await readBuildJob(fixture.env.DB, fixture.org.id, fixture.input.buildId),
    ).toEqual({
      ...imageCheckpoint,
      providerRetry: {
        openedAt: TEST_TIME,
        failures: 1,
        retryAt: TEST_TIME + 1_000,
      },
    })
    expect(completeAfterFailure).toBe(false)
    expect(boat.deletedIds).toEqual([])
    expect(fixture.provider.commands).toHaveLength(2)
    expect(fixture.access.activeTokens).toEqual([`${INSTALLATION_TOKEN}_1`])
    fixture.provider.beforeStatus = undefined
    runtime.dependencies.now = () => TEST_TIME + 1_000
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
    claim.release()
    let complete = false
    for (let step = 0; step < 20 && !complete; step++) {
      await fixture.provider.settle()
      complete = await advance()
    }
    expect(complete).toBe(true)
    expect(
      (
        await readBuildJob(
          fixture.env.DB,
          fixture.org.id,
          fixture.input.buildId,
        )
      ).state,
    ).toBe('succeeded')
    expect(fixture.provider.commands).toHaveLength(3)
    expect(fixture.provider.statusIds).toEqual([1, 2, 2, 3])
    expect(fixture.access.requests.map((request) => request.method)).toEqual([
      'POST',
      'DELETE',
    ])
    expect(
      fixture.access.events.filter((event) =>
        ['mint', 'claim', 'revoke', 'finalize'].includes(event),
      ),
    ).toEqual(['mint', 'claim', 'revoke', 'finalize'])
    expect(order).toEqual(['software', 'install', 'cleanup'])
  } finally {
    claim.release()
    await fixture.dispose()
  }
})
