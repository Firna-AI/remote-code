import type { RunnerAttachment } from '../../src/shared/generated/RunnerAttachment'
import type { AppEnv } from '../env'
import { workspaceRepositoryLocations } from '../lifecycle/repository-location-data'
import { repositoryLocation } from '../lifecycle/repository-locations'
import {
  attachmentWorkspace,
  type AttachmentWorkspace,
} from './attachment-claim-data'
import { attachmentNotFound } from './attachment-record'
import type { StoredAttachment } from './types'

export async function attachmentRepositoryDirectory(
  db: D1Database,
  workspace: AttachmentWorkspace,
): Promise<string> {
  return repositoryLocation(
    await workspaceRepositoryLocations(db, workspace.id),
    workspace.repositoryId,
  )
}

/** Resolve again for every send, including a send that uses stored copy proof. */
export async function resolveAttachmentPaths(
  env: AppEnv,
  workspaceId: string,
  userId: string,
  attachments: readonly StoredAttachment[],
): Promise<readonly RunnerAttachment[]> {
  if (attachments.length === 0) return []
  const workspace = await attachmentWorkspace(env.DB, workspaceId, userId)
  if (!workspace) throw attachmentNotFound()
  const directory = await attachmentRepositoryDirectory(env.DB, workspace)
  return attachments.map((attachment) => ({
    attachmentId: attachment.attachmentId,
    path: `${directory}/${attachment.relativePath}`,
  }))
}
