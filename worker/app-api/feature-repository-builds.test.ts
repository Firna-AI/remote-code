import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { nested, record } from '../../src/app/api/parse'
import { readUser } from '../../src/app/api/read-core'
import { readRepositories } from '../../src/app/api/read-settings'
import { API_PATHS } from '../../src/shared/api'
import {
  createOuterRuntime,
  outerWorkerBundle,
  type OuterRuntime,
} from '../chat/integration/outer-runtime.test-support'
import { OUTER_ORG } from '../chat/integration/outer-seed.test-support'
import type { AppEnv } from '../env'
import { SOFTWARE } from '../lifecycle/backend-test-support'
import {
  failBuild,
  readBuildHistory,
  readBuildJob,
  runningBuild,
} from '../lifecycle/build-data'
import { startImageBuild } from '../lifecycle/image-builds'
import { imageRuntime } from '../lifecycle/runtime'
import { withSoftwareRelease } from '../lifecycle/software-release-test-support'
import { changeShellRepository } from './feature-repositories'
import { shellRepositoryId } from './feature-repositories-data'
import { shellGitHubCatalog } from './feature-shell.test-support'

let bundle: string
let fixture: OuterRuntime | undefined
beforeAll(async () => {
  bundle = await outerWorkerBundle()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture?.dispose()
  fixture = undefined
})

async function setup() {
  const active = (fixture = await createOuterRuntime(bundle))
  await shellGitHubCatalog(active)
  const user = nested(
    record(await (await active.request(API_PATHS.session)).json()),
    'user',
    readUser,
  )
  const bindings = await active.runtime.getBindings<{
    WORKSPACES: NonNullable<AppEnv['WORKSPACES']>
  }>()
  const env: AppEnv = {
    ...active.env,
    WORKSPACES: bindings.WORKSPACES,
  }
  let sequence = 0
  const dependencies = {
    fetch: withSoftwareRelease(active.github.fetch),
    now: () => 3_000_000_000_000,
    randomToken: () => `repository-build-${++sequence}`,
  }
  const repositoryId = shellRepositoryId(OUTER_ORG, 202)
  const save = (selected: boolean, suppliedEnv = env) =>
    changeShellRepository(
      suppliedEnv,
      OUTER_ORG,
      user.id,
      repositoryId,
      selected,
      dependencies,
    )
  const start = () =>
    startImageBuild(imageRuntime(env, dependencies), {
      orgId: OUTER_ORG,
      userId: user.id,
      kind: 'build',
      software: SOFTWARE,
    })
  return { env, user, repositoryId, dependencies, save, start }
}

it('starts a build for the admin on an add, but not on a repeated save or a removal', async () => {
  const { env, user, repositoryId, dependencies, save } = await setup()
  const before = (await readBuildHistory(env.DB, OUTER_ORG)).builds.length
  const response = await save(true)
  expect(response.status).toBe(200)
  expect(readRepositories(await response.json())).toContainEqual(
    expect.objectContaining({ id: repositoryId, selected: true }),
  )
  const id = await runningBuild(env.DB, OUTER_ORG)
  expect(id).not.toBe(null)
  if (id === null) throw new Error('Missing repository build')
  const job = await readBuildJob(env.DB, OUTER_ORG, id)
  expect(job).toMatchObject({ kind: 'build', startedByUserId: user.id })
  expect(JSON.parse(job.repositoriesJson)).toContainEqual({
    id: repositoryId,
    orgId: OUTER_ORG,
    fullName: 'owner/another-repository',
    defaultBranch: 'trunk',
  })
  await failBuild(env.DB, id, 'The build failed.', dependencies.now())
  expect((await save(true)).status).toBe(200)
  expect(await runningBuild(env.DB, OUTER_ORG)).toBe(null)
  const removed = await save(false)
  expect(readRepositories(await removed.json())).toContainEqual(
    expect.objectContaining({ id: repositoryId, selected: false }),
  )
  expect(await runningBuild(env.DB, OUTER_ORG)).toBe(null)
  expect((await readBuildHistory(env.DB, OUTER_ORG)).builds).toHaveLength(
    before + 1,
  )
})

it('starts an added repository build after a failed build', async () => {
  const { env, user, dependencies, save, start } = await setup()
  const failed = await start()
  await failBuild(env.DB, failed, 'The build failed.', dependencies.now())
  expect((await save(true)).status).toBe(200)
  const id = await runningBuild(env.DB, OUTER_ORG)
  expect(id).not.toBe(null)
  expect(id).not.toBe(failed)
  if (id === null) throw new Error('Missing repository build')
  expect(await readBuildJob(env.DB, OUTER_ORG, id)).toMatchObject({
    kind: 'build',
    startedByUserId: user.id,
  })
})

it('keeps a saved repository and warns once when its build cannot start', async () => {
  const { env, repositoryId, save } = await setup()
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const response = await save(true, { ...env, WORKSPACES: undefined })
  expect(response.status).toBe(200)
  expect(readRepositories(await response.json())).toContainEqual(
    expect.objectContaining({ id: repositoryId, selected: true }),
  )
  expect(await runningBuild(env.DB, OUTER_ORG)).toBe(null)
  expect(warning.mock.calls).toEqual([
    [
      {
        kind: 'repository_image_build_start_failed',
        message:
          'Could not start the cloud computer build for the added repository.',
      },
    ],
  ])
})
