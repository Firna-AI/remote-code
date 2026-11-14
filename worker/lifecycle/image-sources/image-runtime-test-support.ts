import { withSoftwareRelease } from '../software-release-test-support'
import { TEST_TIME } from '../../test-support/harness'
import { LifecycleBoat } from '../lifecycle-boat-test-support'
import type { ImageRuntime } from '../image-builds'
import { createGitHubImageSourceMaterializer } from './materialize'
import { SourceCommandPort } from './source-commands'
import type { localSourceFixture } from './local-source-test-support'

/** Native sources use real Git. Other image operations keep the lifecycle provider boundary. */
export async function nativeImageRuntime(
  fixture: Awaited<ReturnType<typeof localSourceFixture>>,
) {
  const boat = new LifecycleBoat()
  const dependencies = {
    now: () => TEST_TIME,
    randomToken: () => 'image-runtime-unused',
    fetch: withSoftwareRelease((request: Request) =>
      new URL(request.url).hostname === 'boat.dev'
        ? boat.fetch(request)
        : fixture.access.fetch(request),
    ),
  }
  const runtime: ImageRuntime = {
    env: fixture.env,
    dependencies,
    prepareSources: (input) =>
      createGitHubImageSourceMaterializer(
        fixture.env,
        dependencies,
      )({
        ...input,
        commands: new SourceCommandPort(fixture.provider, input.sandboxId),
      }),
    scheduler: { schedule: async () => {} },
  }
  return { runtime, boat }
}
