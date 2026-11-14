import type { GitHubRepository } from '../../src/shared/account'
import type { OrgSummary } from '../../src/shared/orgs'
import { latestSoftwareRelease } from '../lifecycle/software-release'
import { requireActiveUser, suspendedUserError } from '../data/user-access'
import type { AppDependencies, AppEnv } from '../env'
import { HttpError, requiredString } from '../http'
import { startImageBuild } from '../lifecycle/image-builds'
import { imageRuntime } from '../lifecycle/runtime'
import type { RequestContext } from '../security/gate'
import { warnWorker } from '../warnings'
import { shellGitHubAccess } from './feature-github'
import { insertShellOrg } from './feature-org-data'
import { invalidShellInput, optionalShellString } from './feature-shell-access'
import { workspaceBinding } from './workspace-state'

export async function createShellOrg(
  env: AppEnv,
  context: RequestContext,
  dependencies: AppDependencies,
): Promise<Response> {
  const name = requiredString(context.body?.name)
  const initials = optionalShellString(context.body?.initials)
  const ids: unknown = context.body?.repositoryIds ?? []
  if (!Array.isArray(ids)) throw invalidShellInput()
  const repositoryIds = new Set<number>()
  for (const value of ids) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
      throw invalidShellInput()
    repositoryIds.add(value)
  }
  await requireActiveUser(env.DB, context.user.id)
  if (repositoryIds.size === 0)
    throw new HttpError(
      400,
      'repository_required',
      'Choose at least one repository.',
    )
  const repositories: GitHubRepository[] = []
  if (repositoryIds.size) {
    const access = await shellGitHubAccess(env, context.user.id, dependencies)
    for (const id of repositoryIds) {
      const repository = access.repositories.find(
        (entry) => entry.githubId === id,
      )
      if (!repository)
        throw new HttpError(
          404,
          'repository_not_found',
          'The repository is not available.',
        )
      repositories.push(repository)
    }
  }
  const id = dependencies.randomToken()
  if (
    !(await insertShellOrg(env.DB, {
      id,
      name,
      initials,
      userId: context.user.id,
      repositories,
      now: dependencies.now(),
    }))
  ) {
    throw suspendedUserError()
  }
  try {
    await startImageBuild(
      imageRuntime({ ...env, WORKSPACES: workspaceBinding(env) }, dependencies),
      {
        orgId: id,
        userId: context.user.id,
        kind: 'build',
        software: await latestSoftwareRelease(env, dependencies.fetch),
      },
    )
  } catch {
    warnWorker({ kind: 'first_image_build_start_failed' })
  }
  const org: OrgSummary = { id, name, role: 'admin' }
  if (initials !== undefined) org.initials = initials
  return Response.json({ org }, { status: 201 })
}
