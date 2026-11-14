import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { nested, record } from '../../src/app/api/parse'
import { readOrg, readUser } from '../../src/app/api/read-core'
import { API_PATHS, orgPath } from '../../src/shared/api'
import {
  createOuterRuntime,
  outerWorkerBundle,
  type OuterRuntime,
} from '../chat/integration/outer-runtime.test-support'
import type { AppEnv } from '../env'
import { readBuildHistory, readBuildJob } from '../lifecycle/build-data'
import { withSoftwareRelease } from '../lifecycle/software-release-test-support'
import { createShellOrg } from './feature-org'
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
  const env = {
    ...active.env,
    WORKSPACES: bindings.WORKSPACES,
  }
  let sequence = 0
  const dependencies = {
    fetch: withSoftwareRelease(active.github.fetch),
    now: () => 3_000_000_000_000,
    randomToken: () => `first-build-${++sequence}`,
  }
  const create = (repositoryIds: number[], suppliedEnv: AppEnv = env) =>
    createShellOrg(
      suppliedEnv,
      {
        user,
        sessionId: 'owner-session',
        org: null,
        body: { name: 'New org', repositoryIds },
      },
      dependencies,
    )
  return { active, env, user, create }
}

it('refuses Create org without a repository before it writes the org', async () => {
  const { active, create } = await setup()
  await expect(create([])).rejects.toMatchObject({
    status: 400,
    code: 'repository_required',
    message: 'Choose at least one repository.',
  })
  expect(
    await active.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM orgs WHERE name = 'New org'",
    ).first('count'),
  ).toBe(0)
})

it('records the creator and chosen repositories in a running build before Create org answers', async () => {
  const { active, user, create } = await setup()
  const response = await create([202])
  expect(response.status).toBe(201)
  const org = nested(record(await response.json()), 'org', readOrg)
  const history = await readBuildHistory(active.env.DB, org.id)
  expect(history.builds).toHaveLength(1)
  expect(history.builds[0]).toMatchObject({ kind: 'build', state: 'running' })
  const job = await readBuildJob(active.env.DB, org.id, history.builds[0].id)
  expect(job.startedByUserId).toBe(user.id)
  expect(JSON.parse(job.repositoriesJson)).toEqual([
    {
      id: shellRepositoryId(org.id, 202),
      orgId: org.id,
      fullName: 'owner/another-repository',
      defaultBranch: 'trunk',
    },
  ])
})

it('keeps a created org and answers 201 when its first build cannot start', async () => {
  const { active, env, create } = await setup()
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const response = await create([202], { ...env, WORKSPACES: undefined })
  expect(response.status).toBe(201)
  const org = nested(record(await response.json()), 'org', readOrg)
  expect(await (await active.request(orgPath(org.id))).json()).toEqual({
    org,
  })
  expect(await readBuildHistory(active.env.DB, org.id)).toEqual({
    builds: [],
    currentImageBuildId: null,
    changes: {
      installScript: false,
      addedRepositories: [],
      removedRepositories: [],
    },
  })
  expect(warning.mock.calls).toEqual([
    [
      {
        kind: 'first_image_build_start_failed',
        message: 'Could not start the first cloud computer build.',
      },
    ],
  ])
})
