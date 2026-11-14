import type { FileTreeResponse } from './generated/FileTreeResponse'
import type { FileTreeDelta } from './generated/FileTreeDelta'
import type { ChangesResponse } from './generated/ChangesResponse'
import { workspacePath } from './workspaces'

function fileQuery(orgId: string, id: string, route: string, path: string) {
  return `${workspacePath(orgId, id)}/${route}?${new URLSearchParams({ path })}`
}

export const filePaths = {
  tree: (orgId: string, id: string) => `${workspacePath(orgId, id)}/files/tree`,
  content: (orgId: string, id: string, path: string) =>
    fileQuery(orgId, id, 'files/content', path),
  download: (orgId: string, id: string, path: string) =>
    fileQuery(orgId, id, 'files/download', path),
  changes: (orgId: string, id: string) => `${workspacePath(orgId, id)}/changes`,
  diff: (orgId: string, id: string, path: string) =>
    fileQuery(orgId, id, 'changes/diff', path),
  attachments: (orgId: string, id: string) =>
    `${workspacePath(orgId, id)}/attachments`,
} as const

/** Browser events carry complete reports or unavailable marks. Runner parts use RunnerFileEvent. */
export type FileEvent =
  | { type: 'files.snapshot'; tree: FileTreeResponse }
  | { type: 'files.unavailable' }
  | { type: 'files.changed'; delta: FileTreeDelta }
  | { type: 'changes.updated'; changes: ChangesResponse }

/**
 * Maximum UTF-8 bytes of JSON.stringify(one complete RunnerFileEvent).
 * Count the discriminator, metadata, escapes, and delimiters, not an envelope.
 * A 256 KiB budget leaves room below the stored event limit for other fields.
 * A path or entry stays whole. Counts alone cannot bound arbitrary path bytes.
 */
export const FILE_EVENT_MAX_BYTES = 262_144

/** Bound the tree work of one delta, as well as its serialized byte size. */
export const FILE_TREE_DELTA_MAX_CHANGES = 512

/** Maximum bytes of a file or diff read. */
export const FILE_READ_MAX_BYTES = 5_242_880
export interface FileTooLargeResponse {
  error: {
    code: 'file_too_large'
    message: string
    sizeBytes: number
    limitBytes: number
  }
}
