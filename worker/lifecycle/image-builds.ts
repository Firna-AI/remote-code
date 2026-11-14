import { insertBuild } from './build-admission-data'
import type { ImageBuild } from '../../src/shared/org-settings'
import type { AppDependencies, AppEnv } from '../env'
import { HttpError } from '../http'
import {
  requireActiveOrg,
  requireActiveUser,
  userSuspended,
} from '../data/user-access'
import { orgProviderForAccount, providerForAccount } from '../sandbox/client'
import { DEFAULT_PROVIDER_ACCOUNT } from '../sandbox/account-identity'
import { latestSoftwareRelease } from './software-release'
import { softwareVersion } from '../software-image/version'
import type { SandboxProvider } from '../sandbox/provider'
import { IMAGE_BUILD_TIME_LIMIT_MS, JobTimeLimit } from './job-time-limit'
import {
  providerRetryPending,
  providerRetryExpired,
  ProviderRetryExhausted,
} from './provider-retry'
import {
  progressImageRetry,
  clearImageRetryStatement,
} from './image-retry-data'
import { readSourceJob } from './image-sources/source-data'
import { imageSourceFailure } from './image-sources/materialize'
import { advanceBuildStep } from './image-build-steps'
import { cleanupBuildImageSources } from './image-sources/cleanup'
import type { SourceCommandPort } from './image-sources/source-commands'
import { requireOrgMember } from './access'
import { jobSoftware, readBuildJob, runningBuild } from './build-data'
import { cleanupBuild } from './build-execution'
import { readImageSoftware, type ImageSoftwareArtifact } from './image-software'
import { IMAGE_DAY_MS } from './image-schedule'
import { readOrgImage } from './org-image-data'
import {
  failUnscheduledBuild,
  handleImageBuildFailure,
} from './image-build-failure'
import {
  firstOrgAdmin,
  readImageSettings,
  readRepositories,
  selectedRepositories,
  type SelectedRepository,
} from './settings-data'
import {
  capturedRepositoryLocations,
  repositoryLocations,
  type RepositoryLocation,
} from './repository-locations'

interface ImageScheduler {
  schedule(
    orgId: string,
    software: ImageSoftwareArtifact,
    at: number,
    buildId: string | null,
    providerAccount?: string,
  ): Promise<void>
}

/** An authorized source transfer may stage private repositories without saved credentials. */
export type PrepareImageSources = (input: {
  orgId: string
  buildId: string
  sandboxId: string
  providerAccount: string
  repositories: readonly SelectedRepository[]
  repositoryLocations?: readonly RepositoryLocation[]
  previousRepositoryLocations?: readonly RepositoryLocation[]
  commands: SourceCommandPort
}) => Promise<boolean | void>

export interface ImageRuntime {
  env: AppEnv
  dependencies: AppDependencies
  scheduler: ImageScheduler
  prepareSources: PrepareImageSources
}

export async function startImageBuild(
  runtime: ImageRuntime,
  input: {
    orgId: string
    userId: string
    kind: ImageBuild['kind']
    software: ImageSoftwareArtifact
    dailyRefresh?: boolean
  },
  providerAccount = DEFAULT_PROVIDER_ACCOUNT,
): Promise<string> {
  const { env, dependencies } = runtime
  await requireActiveOrg(env.DB, input.orgId)
  await requireOrgMember(env.DB, input.orgId, input.userId, true)
  const software = readImageSoftware(input.software)
  const existing = await runningBuild(env.DB, input.orgId)
  if (existing) {
    const job = await readBuildJob(env.DB, input.orgId, existing)
    await runtime.scheduler.schedule(
      input.orgId,
      jobSoftware(job),
      dependencies.now(),
      existing,
      job.providerAccount,
    )
    return existing
  }
  const settings = await readImageSettings(env.DB, input.orgId)
  const image = await readOrgImage(env.DB, input.orgId, providerAccount)
  if (input.kind === 'refresh' && !image?.imageName)
    throw new HttpError(
      409,
      'image_required',
      'Build the cloud computer image first.',
    )
  const previous = image?.imageBuildId
    ? await readBuildJob(env.DB, input.orgId, image.imageBuildId)
    : null
  const previousRepositories = previous
    ? readRepositories(JSON.parse(previous.repositoriesJson))
    : []
  const previousLocations = previous
    ? capturedRepositoryLocations(
        previous.repositoryLocationsJson,
        previousRepositories,
      )
    : []
  const repositories =
    input.kind === 'refresh' && previous
      ? previousRepositories
      : await selectedRepositories(env.DB, input.orgId)
  const locations =
    input.kind === 'refresh' && previous
      ? previousLocations
      : repositoryLocations(repositories)
  const id = dependencies.randomToken()
  const now = dependencies.now()
  try {
    await insertBuild(env.DB, {
      id,
      orgId: input.orgId,
      providerAccount,
      previousProviderAccount: previous?.providerAccount ?? providerAccount,
      userId: input.userId,
      kind: input.kind,
      settingsRevision:
        input.kind === 'refresh' && previous
          ? previous.settingsRevision
          : settings.revision,
      installScript: settings.installScript,
      repositories,
      repositoryLocations: locations,
      previousRepositoryLocations: previousLocations,
      software,
      softwareVersion:
        input.kind === 'build' && !image?.imageName
          ? await softwareVersion(
              await latestSoftwareRelease(env, dependencies.fetch),
            )
          : undefined,
      previousImageName: image?.imageName ?? null,
      now,
      nextImageRefreshAt:
        input.kind === 'refresh' && input.dailyRefresh
          ? now + IMAGE_DAY_MS
          : undefined,
    })
  } catch (error) {
    const current = await runningBuild(env.DB, input.orgId)
    if (!current) throw error
    const job = await readBuildJob(env.DB, input.orgId, current)
    await runtime.scheduler.schedule(
      input.orgId,
      jobSoftware(job),
      dependencies.now(),
      current,
      job.providerAccount,
    )
    return current
  }
  try {
    await runtime.scheduler.schedule(
      input.orgId,
      software,
      dependencies.now(),
      id,
      providerAccount,
    )
  } catch (error) {
    await failUnscheduledBuild(runtime, id)
    throw error
  }
  return id
}

/** One durable alarm advances one job. Offsets and logs commit together in D1. */
export async function advanceImageBuild(
  runtime: ImageRuntime,
  orgId: string,
  buildId: string,
): Promise<boolean> {
  const { env, dependencies } = runtime
  const job = await readBuildJob(env.DB, orgId, buildId)
  let provider: SandboxProvider | undefined
  const recoveringAllocation = job.phase === 'allocating' && !job.sandboxId
  const firstAllocation = job.phase === 'create'
  const cleaningUp = job.phase === 'cleanup' || job.state !== 'running'
  const activeWork = !recoveringAllocation && !cleaningUp
  try {
    const expired =
      dependencies.now() >= job.startedAt + IMAGE_BUILD_TIME_LIMIT_MS
    if (job.phase === 'sources' && job.state === 'running' && !expired) {
      const source = await readSourceJob(env.DB, buildId)
      if (source && (source.failed || source.phase === 'abort')) {
        await clearImageRetryStatement(env.DB, buildId).run()
        if (!(await cleanupBuildImageSources(env, dependencies.fetch, buildId)))
          return false
        throw imageSourceFailure()
      }
    }
    if (activeWork) await requireActiveOrg(env.DB, orgId)
    const suspended =
      activeWork &&
      job.startedByUserId !== null &&
      (await userSuspended(env.DB, job.startedByUserId))
    if (
      !cleaningUp &&
      !expired &&
      !suspended &&
      providerRetryPending(job.providerRetry, dependencies.now())
    )
      return false
    if (
      cleaningUp &&
      !(await cleanupBuildImageSources(env, dependencies.fetch, buildId))
    )
      return false
    if (cleaningUp)
      return await cleanupBuild(
        runtime,
        providerForAccount(env, dependencies.fetch, job.providerAccount),
        job,
      )
    const admin = await firstOrgAdmin(env.DB, orgId)
    if (!admin)
      throw new HttpError(404, 'org_not_found', 'The org is not available.')
    provider = await orgProviderForAccount(
      env,
      admin.userId,
      orgId,
      dependencies.fetch,
      job.providerAccount,
    )
    if (!recoveringAllocation && job.startedByUserId)
      await requireActiveUser(env.DB, job.startedByUserId, orgId)
    if (expired) throw new JobTimeLimit('build')
    if (providerRetryExpired(job.providerRetry, dependencies.now()))
      throw new ProviderRetryExhausted()
    const done = await advanceBuildStep(runtime, provider, job)
    if (!done) await progressImageRetry(env.DB, buildId)
    return done
  } catch (error) {
    return handleImageBuildFailure(runtime, {
      orgId,
      buildId,
      provider,
      firstAllocation,
      error,
    })
  }
}
