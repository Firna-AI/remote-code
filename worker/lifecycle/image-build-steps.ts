import { publishBuild } from './build-admission-data'
import type { SandboxProvider } from '../sandbox/provider'
import { requireActiveOrg, requireActiveUser } from '../data/user-access'
import {
  assignBuildSnapshot,
  readBuildJob,
  updateBuildJob,
  type BuildJob,
} from './build-data'
import { allocateImageBuild } from './image-allocation'
import { advanceBuildCommand, cleanupBuild } from './build-execution'
import { completeBuildPhase } from './build-phase-data'
import { clearImageCommands } from './command-intents'
import type { ImageRuntime } from './image-builds'
import { SourceCommandPort } from './image-sources/source-commands'
import { providerState } from './provider-state'
import { buildSnapshotIntent, createResource } from './resource-intents'
import {
  capturedRepositoryLocations,
  readRepositoryLocations,
} from './repository-locations'
import { readRepositories } from './settings-data'
import { IMAGE_BUILD_TIME_LIMIT_MS, JobTimeLimit } from './job-time-limit'

export async function advanceBuildStep(
  runtime: ImageRuntime,
  provider: SandboxProvider,
  job: BuildJob,
): Promise<boolean> {
  const { env, dependencies } = runtime
  const { buildId, orgId } = job
  const recoveringAllocation = job.phase === 'allocating' && !job.sandboxId
  if (!recoveringAllocation) await requireActiveOrg(env.DB, orgId)
  if (job.phase === 'create') {
    await updateBuildJob(env.DB, buildId, 'allocating')
    job = { ...job, phase: 'allocating' }
  }
  if (job.phase === 'allocating') {
    if (!recoveringAllocation && job.startedByUserId)
      await requireActiveUser(env.DB, job.startedByUserId)
    await allocateImageBuild(env.DB, provider, job, recoveringAllocation)
    return false
  }
  if (!job.sandboxId) throw new Error('Missing build sandbox')
  const machine = await provider.get(job.sandboxId)
  const status = providerState(machine.state)
  if (status === 'error' || status === 'stopped')
    throw new Error('Image sandbox did not start')
  if (status !== 'ready') return false
  // A long build receives the same safety deadline as other active work.
  await provider.setAutoStop(job.sandboxId, 1_800)
  if (dependencies.now() >= job.startedAt + IMAGE_BUILD_TIME_LIMIT_MS)
    throw new JobTimeLimit('build')
  if (job.phase === 'snapshot') {
    if (job.snapshotName === null)
      await clearImageCommands(provider, job.sandboxId)
    await requireActiveOrg(env.DB, orgId)
    const snapshot = await createResource(
      runtime.env.DB,
      provider,
      buildSnapshotIntent(env.DB, job),
    )
    await assignBuildSnapshot(
      env.DB,
      buildId,
      snapshot.name,
      job.providerAccount,
    )
    if (snapshot.status === 'failed') throw new Error('Image save failed')
    if (snapshot.status === 'ready')
      await completeBuildPhase(env.DB, buildId, 'publish')
    return false
  }
  if (job.phase === 'publish') {
    await requireActiveOrg(env.DB, orgId)
    await publishBuild(env.DB, job, dependencies.now())
    job = await readBuildJob(env.DB, orgId, buildId)
    return await cleanupBuild(runtime, provider, job)
  }
  if (job.phase === 'sources') {
    await requireActiveOrg(env.DB, orgId)
    const prepared = await runtime.prepareSources({
      orgId,
      buildId,
      sandboxId: job.sandboxId,
      providerAccount: job.providerAccount,
      repositories: readRepositories(JSON.parse(job.repositoriesJson)),
      repositoryLocations: capturedRepositoryLocations(
        job.repositoryLocationsJson,
        readRepositories(JSON.parse(job.repositoriesJson)),
      ),
      previousRepositoryLocations:
        job.previousRepositoryLocationsJson === null
          ? undefined
          : readRepositoryLocations(
              JSON.parse(job.previousRepositoryLocationsJson),
            ),
      commands: new SourceCommandPort(provider, job.sandboxId),
    })
    if (prepared === false) return false
    await completeBuildPhase(env.DB, buildId, 'software')
    return false
  }
  await requireActiveOrg(env.DB, orgId)
  return await advanceBuildCommand(runtime, provider, job)
}
