import type { AppDependencies, AppEnv } from '../env'
import {
  workspaceBinding,
  workspaceForViewer,
} from '../app-api/workspace-state'
import { readWorkspace, workspaceView } from '../lifecycle/workspace-data'
import { DISK_KEEPALIVE_MS } from '../lifecycle/durable-types'
import { workspaceOwnerChangedHook } from '../lifecycle/ownership-maintenance'
import { workspaceRuntime } from '../lifecycle/runtime'
import { withImageSourceCleanup } from '../lifecycle/image-sources/members'
import { readImageSchedule, IMAGE_DAY_MS } from '../lifecycle/image-schedule'
import { latestSoftwareRelease } from '../lifecycle/software-release'
import { requireOrgMember } from './permissions'
import type { MembersHooks } from './route'
import {
  orgLifecycleReceivers,
  stopOrgLifecycleRecords,
  hiddenOrgReceivers,
} from './composition-data'
import type { LifecycleOwnership } from './lifecycle-contract'
import { requireFeatureResult, type FeatureResult } from '../features/result'
import { purgeWorkspaceAttachments } from '../chat/attachment-cleanup'
import { WORKSPACE_RESTORE_MS } from '../../src/shared/workspaces'

async function apply(operation: Promise<FeatureResult<void>>): Promise<void> {
  requireFeatureResult(await operation)
}

const fence = (ownership: LifecycleOwnership) => ({
  orgId: ownership.orgId,
  generation: ownership.generation,
})

export function productionMembersHooks(
  env: AppEnv,
  dependencies: AppDependencies,
): MembersHooks {
  const receiver = (id: string) =>
    workspaceBinding(env).getByName(id, { locationHint: 'weur' })
  return withImageSourceCleanup(env, dependencies.fetch, {
    workspaceOwnerChanged: workspaceOwnerChangedHook(
      workspaceRuntime(env, dependencies),
    ),
    async readWorkspace(orgId, workspaceId, userId) {
      await requireOrgMember(env.DB, orgId, userId)
      return workspaceForViewer(
        env,
        userId,
        workspaceView(
          await readWorkspace(env.DB, orgId, workspaceId),
          env.APP_ORIGIN,
        ),
      )
    },
    async suspendOrg(orgId, workspaceIds, ownership) {
      await apply(
        receiver(`org-image:${orgId}`).suspendMemberLifecycle(
          fence(ownership),
          null,
        ),
      )
      await ownership.renew()
      const ids = new Set([
        ...workspaceIds,
        ...(await orgLifecycleReceivers(env.DB, orgId)),
      ])
      for (const id of ids) {
        await apply(receiver(id).suspendMemberLifecycle(fence(ownership), id))
        await ownership.renew()
      }
      await stopOrgLifecycleRecords(
        env.DB,
        orgId,
        ownership.generation,
        dependencies.now(),
      )
      await ownership.renew()
    },
    async maintainDeletedOrg(input) {
      for (const disk of input.workspaces) {
        await input.ownership.renew()
        const expiresAt =
          disk.archivedAt === undefined
            ? Infinity
            : disk.archivedAt + WORKSPACE_RESTORE_MS
        const due = Math.min(
          disk.nextKeepaliveAt ?? disk.stoppedAt + DISK_KEEPALIVE_MS,
          expiresAt,
        )
        await input.retention.schedule(disk.workspaceId, due)
        if (input.mode === 'retention' && due <= input.now && due < expiresAt) {
          const stopped = await input.retention.restart(disk.workspaceId, 1_800)
          await input.retention.schedule(
            disk.workspaceId,
            Math.min(stopped.stoppedAt + DISK_KEEPALIVE_MS, expiresAt),
          )
        }
      }
    },
    async restoreOrgMaintenance(input) {
      const next = await readImageSchedule(env.DB, input.orgId, input.now, {
        buildId: null,
        nextAt: input.now + IMAGE_DAY_MS,
      })
      const image =
        next.buildId === null && !next.imageName
          ? null
          : {
              orgId: input.orgId,
              software: await latestSoftwareRelease(env, dependencies.fetch),
              buildId: next.buildId,
              nextAt: next.nextAt,
            }
      await apply(
        receiver(`org-image:${input.orgId}`).restoreMemberLifecycle(
          fence(input.ownership),
          null,
          image,
        ),
      )
      await input.ownership.renew()
      const ids = new Set([
        ...input.workspaceIds,
        ...(await orgLifecycleReceivers(env.DB, input.orgId)),
      ])
      for (const id of ids) {
        await apply(
          receiver(id).restoreMemberLifecycle(
            fence(input.ownership),
            input.workspaces.find((disk) => disk.workspaceId === id) ?? null,
            null,
          ),
        )
        await input.ownership.renew()
      }
    },
    async deleteWorkspaceState(orgId, workspaceId, ownership) {
      await apply(
        receiver(workspaceId).deleteMemberWorkspaceState(fence(ownership)),
      )
      await ownership.renew()
      await purgeWorkspaceAttachments(env, workspaceId, () => ownership.renew())
      await apply(
        receiver(`org-image:${orgId}`).deleteMemberWorkspaceState(
          fence(ownership),
        ),
      )
      await ownership.renew()
    },
    async deleteOrgState(orgId, ownership) {
      for (const id of await hiddenOrgReceivers(env.DB, orgId)) {
        await apply(receiver(id).deleteMemberWorkspaceState(fence(ownership)))
        await ownership.renew()
      }
      await apply(
        receiver(`org-image:${orgId}`).deleteMemberWorkspaceState(
          fence(ownership),
        ),
      )
      await ownership.renew()
    },
  } satisfies MembersHooks)
}
