import { expect, it } from 'vitest'

import { RUNNER_PROTOCOL_VERSION } from '../../src/shared/runner'
import { setupBackendTests } from './backend-test-hooks'
import { SOFTWARE } from './backend-test-support'
import { FIRST_MESSAGE } from './durable-test-support'
import { startImageBuild } from './image-builds'
import { seedPublishedImage } from './published-image-test-support'
import { createWorkspace } from './workspaces'

const fixtureForTest = setupBackendTests()

it.each([
  {
    kind: 'refresh',
    sourceVersion: 1,
    expectedVersion: RUNNER_PROTOCOL_VERSION,
  },
  { kind: 'refresh', sourceVersion: 2, expectedVersion: 2 },
  {
    kind: 'build',
    sourceVersion: 1,
    expectedVersion: RUNNER_PROTOCOL_VERSION,
  },
] as const)(
  'records runner version $expectedVersion for a $kind from a version $sourceVersion image',
  async ({ kind, sourceVersion, expectedVersion }) => {
    const { images, org, user, runtime } = fixtureForTest()
    await runtime.env.DB.prepare(
      'UPDATE image_builds SET runner_protocol_version = ? WHERE id = ?',
    )
      .bind(sourceVersion, 'published-image')
      .run()
    const build = await startImageBuild(images, {
      orgId: org.id,
      userId: user.id,
      kind,
      software: SOFTWARE,
    })
    expect(
      await runtime.env.DB.prepare(
        'SELECT runner_protocol_version FROM image_builds WHERE id = ?',
      )
        .bind(build)
        .first('runner_protocol_version'),
    ).toBe(expectedVersion)
  },
)

it('pins equal-named images to their own account versions for legacy and gateway workspaces', async () => {
  const fixture = fixtureForTest()
  const { runtime, org, user, repositoryId, boat } = fixture
  boat.server.addAccount({ orgId: 'second-org', apiKey: 'boat-second' })
  runtime.env.SANDBOX_PROVIDER_ACCOUNTS = {
    'boat-second': { kind: 'boat', orgId: 'second-org', apiKey: 'boat-second' },
  }
  const images = [
    { account: 'boat', version: 1, buildId: 'legacy-shared-image' },
    { account: 'boat-second', version: 2, buildId: 'gateway-shared-image' },
  ]
  for (const image of images)
    await seedPublishedImage(runtime.env.DB, {
      orgId: org.id,
      buildId: image.buildId,
      imageName: 'shared-image',
      providerAccount: image.account,
      runnerProtocolVersion: image.version,
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
  for (const image of images) {
    const created = await fixture.run(() =>
      createWorkspace(
        runtime,
        org.id,
        user,
        {
          repositoryId,
          firstMessage: { ...FIRST_MESSAGE, id: image.buildId },
        },
        user,
        image.account,
      ),
    )
    const start = fixture.starts.get(created.workspace.id)
    if (!start) throw new Error('The image start was not admitted.')
    await start.advance()
    expect(
      await runtime.env.DB.prepare(
        'SELECT provider_account AS providerAccount, runner_protocol_version AS runnerProtocolVersion FROM workspaces WHERE id = ?',
      )
        .bind(created.workspace.id)
        .first(),
    ).toEqual({
      providerAccount: image.account,
      runnerProtocolVersion: image.version,
    })
  }
})
