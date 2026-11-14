import { afterEach, beforeAll, expect, it } from 'vitest'

import {
  buildEventsPath,
  buildPath,
  orgSettingsPaths,
} from '../../src/shared/org-settings'
import { record } from '../chat/inputs'
import { outerWorkerBundle } from '../chat/integration/outer-runtime.test-support'
import {
  OUTER_ORG,
  OUTER_SOFTWARE,
} from '../chat/integration/outer-seed.test-support'
import { insertBuild } from '../lifecycle/build-admission-data'
import { readSavedScript } from '../lifecycle/saved-script'
import { DEFAULT_PROVIDER_ACCOUNT } from '../sandbox/account-identity'
import { featureFixture, type FeatureFixture } from './fixture.test-support'

let bundle: string
let fixture: FeatureFixture | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle('worker/features/entry.test-support.ts')
})
afterEach(async () => {
  await fixture?.dispose()
})

it('mounts build history, logs and admin starts and installs the release in the real image coordinator', async () => {
  const active = (fixture = await featureFixture(bundle, {
    configuration: {},
  }))
  const builds = orgSettingsPaths.builds(OUTER_ORG)
  const history = await active.request(builds)
  expect(history.status).toBe(200)
  expect(record(await history.json()).currentImageBuildId).toBe(
    'outer-image-build',
  )
  const member = await active.request(builds, {
    method: 'POST',
    headers: { Cookie: active.cookies.memberCookie },
    body: '{}',
  })
  expect(member.status).toBe(403)
  await insertBuild(active.env.DB, {
    id: 'software-build',
    orgId: OUTER_ORG,
    providerAccount: DEFAULT_PROVIDER_ACCOUNT,
    previousProviderAccount: DEFAULT_PROVIDER_ACCOUNT,
    kind: 'build',
    userId: 'owner',
    settingsRevision: 1,
    installScript: readSavedScript(''),
    repositories: [],
    repositoryLocations: [],
    previousRepositoryLocations: [],
    software: OUTER_SOFTWARE,
    previousImageName: 'outer-image',
    now: await active.actor(`org-image:${OUTER_ORG}`).testAlarmTime(),
  })
  await active.env.DB.batch([
    active.env.DB.prepare(
      "UPDATE image_builds SET sandbox_id = 'bx_software' WHERE id = 'software-build'",
    ),
    active.env.DB.prepare(
      "UPDATE image_build_jobs SET phase = 'software' WHERE build_id = 'software-build'",
    ),
  ])
  const started = await active.request(builds, { method: 'POST', body: '{}' })
  expect(started.status).toBe(202)
  await active.actor(`org-image:${OUTER_ORG}`).advanceStartAlarm()
  expect(
    active.boat.commands.some((command) =>
      command.includes('update check --bootstrap'),
    ),
  ).toBe(true)
  const build = await active.request(buildPath(OUTER_ORG, 'software-build'))
  expect(build.status).toBe(200)
  expect(record(await build.json()).build).toMatchObject({
    id: 'software-build',
    kind: 'build',
  })
  const stream = await active.request(
    buildEventsPath(OUTER_ORG, 'software-build'),
  )
  expect(stream.status).toBe(200)
  expect(stream.headers.get('Content-Type')).toBe('text/event-stream')
  const reader = stream.body?.getReader()
  if (!reader) throw new Error('Missing build stream')
  const first = await reader.read()
  expect(new TextDecoder().decode(first.value)).toContain('event: log')
  await reader.cancel()
})
