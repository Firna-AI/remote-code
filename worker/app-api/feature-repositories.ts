import type { GitHubRepository } from '../../src/shared/account'
import type { Repository } from '../../src/shared/org-settings'
import { latestSoftwareRelease } from '../lifecycle/software-release'
import type { AppDependencies, AppEnv } from '../env'
import { HttpError } from '../http'
import { startImageBuild } from '../lifecycle/image-builds'
import { imageRuntime } from '../lifecycle/runtime'
import {
  assertCanChangeSharedSettings,
  requireOrgMember,
} from '../members/permissions'
import { readGitHubConnection } from '../security/github-connection-store'
import { warnWorker } from '../warnings'
import { shellGitHubAccess } from './feature-github'
import {
  saveShellRepository,
  shellRepositoryId,
} from './feature-repositories-data'
import { shellRepositories } from './shell-data'
import { workspaceBinding } from './workspace-state'

function mergeRepositories(
  orgId: string,
  stored: readonly Repository[],
  available: readonly GitHubRepository[],
): Repository[] {
  const result = new Map<number, Repository>(
    stored.map((repository) => [repository.githubId, repository]),
  )
  for (const repository of available) {
    const previous = result.get(repository.githubId)
    result.set(repository.githubId, {
      ...repository,
      orgId,
      id: previous?.id ?? shellRepositoryId(orgId, repository.githubId),
      selected: previous?.selected ?? false,
    })
  }
  return [...result.values()].sort(
    (a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id),
  )
}

export async function shellRepositoryChoices(
  env: AppEnv,
  orgId: string,
  userId: string,
  dependencies: AppDependencies,
): Promise<Repository[]> {
  await requireOrgMember(env.DB, orgId, userId)
  const stored = await shellRepositories(env.DB, orgId)
  if (!(await readGitHubConnection(env.DB, userId))) return stored
  const access = await shellGitHubAccess(env, userId, dependencies)
  return mergeRepositories(orgId, stored, access.repositories)
}

export async function changeShellRepository(
  env: AppEnv,
  orgId: string,
  userId: string,
  repositoryId: string,
  selected: boolean,
  dependencies: AppDependencies,
): Promise<Response> {
  await assertCanChangeSharedSettings(env.DB, orgId, userId)
  const stored = await shellRepositories(env.DB, orgId)
  let repository = stored.find((entry) => entry.id === repositoryId)
  if (selected) {
    const access = await shellGitHubAccess(env, userId, dependencies)
    const available = access.repositories.find((entry) =>
      repository
        ? entry.githubId === repository.githubId
        : shellRepositoryId(orgId, entry.githubId) === repositoryId,
    )
    if (!available) throw repositoryNotFound()
    repository = {
      ...available,
      orgId,
      id: repository?.id ?? shellRepositoryId(orgId, available.githubId),
      selected,
    }
  }
  if (!repository) throw repositoryNotFound()
  const saved = await saveShellRepository(env.DB, {
    repository,
    userId,
    selected,
    now: dependencies.now(),
  })
  if (!saved.saved) {
    await assertCanChangeSharedSettings(env.DB, orgId, userId)
    throw repositoryNotFound()
  }
  if (saved.added) {
    try {
      await startImageBuild(
        imageRuntime(
          { ...env, WORKSPACES: workspaceBinding(env) },
          dependencies,
        ),
        {
          orgId,
          userId,
          kind: 'build',
          software: await latestSoftwareRelease(env, dependencies.fetch),
        },
      )
    } catch {
      warnWorker({ kind: 'repository_image_build_start_failed' })
    }
  }
  return Response.json({
    repositories: await shellRepositoryChoices(
      env,
      orgId,
      userId,
      dependencies,
    ),
  })
}

function repositoryNotFound(): HttpError {
  return new HttpError(
    404,
    'repository_not_found',
    'The repository is not available.',
  )
}
