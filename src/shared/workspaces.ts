import type { Workspace } from './generated/Workspace'

import type { UserMessage } from './generated/UserMessage'
import type { WorkspaceStart } from './generated/WorkspaceStart'
import { orgPath } from './api'

import type { SendMessageRequest } from './messages'

export const WORKSPACE_RESTORE_MS = 14 * 24 * 60 * 60 * 1_000

export function workspaceRestoreUntil(
  archivedAt: number | null,
  sandboxId: string | null,
): number | null {
  return archivedAt !== null && sandboxId !== null
    ? archivedAt + WORKSPACE_RESTORE_MS
    : null
}

export function workspacesPath(orgId: string): string {
  return `${orgPath(orgId)}/workspaces`
}
export function workspacePath(orgId: string, workspaceId: string): string {
  return `${workspacesPath(orgId)}/${encodeURIComponent(workspaceId)}`
}
export const workspacePaths = {
  resume: (orgId: string, id: string) => `${workspacePath(orgId, id)}/resume`,
  activity: (orgId: string, id: string) =>
    `${workspacePath(orgId, id)}/activity`,
  read: (orgId: string, id: string) => `${workspacePath(orgId, id)}/read`,
  archive: (orgId: string, id: string) => `${workspacePath(orgId, id)}/archive`,
  continue: (orgId: string, id: string) =>
    `${workspacePath(orgId, id)}/continue`,
  continueResult: (orgId: string, id: string, continueId: string) =>
    `${workspacePath(orgId, id)}/continue/${encodeURIComponent(continueId)}`,
  restore: (orgId: string, id: string) => `${workspacePath(orgId, id)}/restore`,
} as const

export interface WorkspaceResponse {
  workspace: Workspace
  start: WorkspaceStart | null
  error: { code: string; message: string; log: string | null } | null
}
export interface OrderedWorkspaceResponse extends WorkspaceResponse {
  /** The workspace event sequence when this read or resume reply was made. */
  eventNumber: number
}
export interface WorkspacesResponse {
  workspaces: readonly Workspace[]
}
export interface CreateWorkspaceRequest {
  repositoryId: string
  sectionId?: string
  firstMessage: SendMessageRequest
}
export interface CreateWorkspaceResponse extends WorkspaceResponse {
  sessionId: string
  firstMessage: UserMessage
}
export interface LocalWork {
  uncommittedFiles: readonly string[]
  unpushedCommits: number
}

export interface ContinueWorkspaceRequest {
  expectedBranch: string
  allowLocalWork?: boolean
}

export type ContinueWorkspaceResponse =
  | { state: 'pending'; continueId: string }
  | {
      state: 'confirmation-required'
      branch: string
      baseBranch: string
      localWork: LocalWork
    }
  | { state: 'continued'; workspace: Workspace; eventNumber: number }
