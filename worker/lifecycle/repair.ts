import { warnWorker } from '../warnings'
import type { ImageRuntime } from './image-builds'
import { scheduleIdleImage } from './image-schedule'
import type { ImageSoftwareArtifact } from './image-software'
import { workspaceOwnerChangedHook } from './ownership-maintenance'
import {
  deferOverdueRepair,
  overdueLifecycleRepairs,
  REPAIR_GRACE_MS,
  REPAIR_LIMIT,
  settleLifecycleRepairs,
  type RepairKind,
} from './repair-data'
import type { WorkspaceRuntime } from './workspace-runtime'

export async function repairLifecycleAlarms(
  runtime: WorkspaceRuntime,
  images: ImageRuntime,
  software: () => ImageSoftwareArtifact | Promise<ImageSoftwareArtifact>,
) {
  const { env, dependencies } = runtime
  const cutoff = dependencies.now() - REPAIR_GRACE_MS
  const due = await overdueLifecycleRepairs(env.DB, cutoff)
  const check = workspaceOwnerChangedHook(runtime)
  const attempted: { kind: RepairKind; id: string }[] = []
  const result = {
    workspaces: 0,
    orgs: 0,
    pendingWorkspaces: 0,
    pendingOrgs: 0,
  }
  const repair = async (kind: RepairKind, id: string) => {
    if (
      !(await deferOverdueRepair(env.DB, kind, id, dependencies.now(), cutoff))
    )
      return
    if (kind === 'workspace') result.workspaces++
    else result.orgs++
    try {
      if (kind === 'workspace') await check(id)
      else await scheduleIdleImage(images, id, await software())
    } catch {
      if (kind === 'workspace') result.pendingWorkspaces++
      else result.pendingOrgs++
    } finally {
      attempted.push({ kind, id })
    }
  }
  for (const kind of ['workspace', 'org'] as const) {
    const rows = kind === 'workspace' ? due.workspaces : due.orgs
    if (rows.length > REPAIR_LIMIT)
      warnWorker({
        kind: 'lifecycle_repair_limited',
        resource: kind,
        limit: REPAIR_LIMIT,
      })
    const selected = rows.slice(0, REPAIR_LIMIT)
    for (const { id } of selected) await repair(kind, id)
  }
  await settleLifecycleRepairs(env.DB, attempted, dependencies.now(), cutoff)
  if (result.pendingWorkspaces || result.pendingOrgs)
    warnWorker({
      kind: 'lifecycle_repair_pending',
      workspaces: result.pendingWorkspaces,
      orgs: result.pendingOrgs,
    })
  return result
}
