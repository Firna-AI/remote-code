import { recordedCreationJob } from './creation-claims'
import { retryCreationIdentity } from './retry-creation-data'
import type { WorkspaceRow } from './workspace-row'
import type { WorkspaceRuntime } from './workspace-runtime'
import { WORKSPACE_START_TIME_LIMIT_MS } from './job-time-limit'

/** Try again reuses admission. It never sends the first message through Send again. */
export async function retryFailedCreation(
  runtime: WorkspaceRuntime,
  row: WorkspaceRow,
  requestedByUserId: string,
): Promise<boolean> {
  const endpoint = runtime.workspace(row.id)
  const result = await endpoint.readCreationLifecycleResult()
  if (result?.ok) return false
  // An absent outcome can precede failure completion or follow a queued retry.
  // Durable admission and the serialized enqueue settle both cases.
  const identity = await retryCreationIdentity(
    runtime.env.DB,
    row.orgId,
    row.id,
  )
  if (!identity) return false
  const original = await recordedCreationJob(
    runtime.env.DB,
    identity.key,
    row.id,
    '',
  )
  const admission = await endpoint.waitCreationAdmission()
  if (!original?.creation || !admission.ok) return false
  await endpoint.queueLifecycleStart(
    {
      ...original,
      creation: { ...original.creation, user: identity.owner },
      kind: 'create',
      phase: 'machine',
      admission: admission.created,
      requestedByUserId,
      attempt: `retry-${row.id}-${runtime.dependencies.randomToken()}`,
      deadlineAt: runtime.dependencies.now() + WORKSPACE_START_TIME_LIMIT_MS,
    },
    { kind: 'retry-failed-create' },
  )
  return true
}
