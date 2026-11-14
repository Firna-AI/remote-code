import { requireActiveStartUsers } from './start-access'
import { providerState } from './provider-state'
import type { AppDependencies, AppEnv } from '../env'
import type { SandboxProvider } from '../sandbox/provider'
import type { WorkspaceRow } from './workspace-row'
import { allocateWorkspace } from './start-allocation'
import { releaseImageLease } from './image-leases'
import {
  recordRunningEnvironment,
  runningEnvironment,
} from './start-environment'
import { workspaceRepositoryLocations } from './repository-location-data'
import { workspaceEnvironmentSettings } from './settings-data'
import { sandboxEnvironment } from './sandbox-environment'
import { ensureWorkspaceToken } from './tokens'
import { WorkspaceStartError } from './workspace-start'
import type { WorkspaceLifecycleEndpoint } from './workspace-runtime'
import type {
  WorkspaceStartJob,
  WorkspaceMachinePhase,
  StartJobStorage,
} from './start-types'
import type { StartCall } from './start-guard'

export async function advanceStartMachine(
  env: AppEnv,
  dependencies: AppDependencies,
  endpoint: WorkspaceLifecycleEndpoint,
  provider: SandboxProvider,
  row: WorkspaceRow,
  job: WorkspaceStartJob,
  storage: StartJobStorage,
  call: StartCall,
): Promise<{
  phase: WorkspaceMachinePhase
  environmentCiphertext: string | null
} | null> {
  const sandboxId = row.sandboxId
  if (job.phase === 'machine') {
    await ensureWorkspaceToken(
      env,
      job.workspaceId,
      dependencies.randomToken,
      dependencies.now(),
    )
    const { runtimeEnv, locations } = await call(async () => {
      const environment = await workspaceEnvironmentSettings(
        env,
        job.orgId,
        job.environmentCiphertext,
      )
      const locations =
        job.repositoryLocations ??
        (await workspaceRepositoryLocations(env.DB, job.workspaceId))
      const runtimeEnv = await sandboxEnvironment(env, {
        workspace: row,
        environment,
        locations,
        defaultBranch: job.baseBranch ?? job.defaultBranch,
        diskKeepalive: false,
      })
      return { runtimeEnv, locations }
    })
    job.repositoryLocations = locations
    await endpoint.lifecycleStep(
      job.kind === 'create' ? 'image' : 'disk',
      job.kind === 'create'
        ? 'Starting from the newest image'
        : 'Resuming with your files as you left them',
      'running',
    )
    if (!sandboxId) {
      await call(async () => {
        await recordRunningEnvironment(
          env.DB,
          job.workspaceId,
          job.environmentCiphertext,
        )
        await requireActiveStartUsers(env.DB, job)
      })
      const sandboxId = await allocateWorkspace(
        env,
        provider,
        storage,
        job,
        async () => ({
          snapshotName: job.imageName ?? undefined,
          name: row.id,
          env: runtimeEnv,
          ttlSeconds: 1_800,
          idempotencyKey: job.attempt,
          labels: {
            user: row.ownerUserId,
            repository: row.repositoryId,
            workspace: row.id,
            org: row.orgId,
          },
        }),
        call,
      )
      if (!sandboxId) return null
    } else {
      job.allocatedSandboxId = sandboxId
      job.providerAccount = row.providerAccount
      await storage.update(job)
      const current = await call(() => provider.get(sandboxId))
      const status = providerState(current.state)
      if (status === 'error') throw new WorkspaceStartError(null)
      if (status === 'starting' || status === 'stopping') return null
      if (status === 'stopped') {
        await call(async () => {
          await recordRunningEnvironment(
            env.DB,
            job.workspaceId,
            job.environmentCiphertext,
          )
          await requireActiveStartUsers(env.DB, job)
          await provider.resume(sandboxId, runtimeEnv, 1_800)
        })
      }
    }
    return {
      phase: 'ready',
      environmentCiphertext: await call(() =>
        runningEnvironment(env.DB, job.workspaceId),
      ),
    }
  }
  if (!sandboxId) throw new WorkspaceStartError(null)
  if (job.phase === 'ready') {
    const machine = await call(() => provider.get(sandboxId))
    const status = providerState(machine.state)
    if (status === 'stopped')
      return {
        phase: 'machine',
        environmentCiphertext: job.environmentCiphertext,
      }
    if (status === 'error') throw new WorkspaceStartError(null)
    if (status !== 'ready') return null
    await call(async () => {
      await provider.setAutoStop(sandboxId, 1_800)
      if (job.kind === 'create')
        await releaseImageLease(env.DB, job.orgId, job.workspaceId)
    })
    await endpoint.lifecycleStep(
      job.kind === 'create' ? 'image' : 'disk',
      job.kind === 'create'
        ? 'Starting from the newest image'
        : 'Resuming with your files as you left them',
      'completed',
    )
    return {
      phase:
        job.afterReadyPhase ?? (job.kind === 'create' ? 'fetch' : 'startup'),
      environmentCiphertext: job.environmentCiphertext,
    }
  }
  return null
}
