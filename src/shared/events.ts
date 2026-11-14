import type { Workspace } from './generated/Workspace'
import type { Timestamp } from './generated/Timestamp'
import type { WorkspaceStart } from './generated/WorkspaceStart'
import type { ChatEvent } from './chat-events'
import type { FileEvent } from './files'
import type { GitHubBanner, GitHubChecksResponse } from './github'
import type { PortsUpdated } from './ports'
import { workspacePath, type WorkspaceResponse } from './workspaces'

export function workspaceEventsPath(
  orgId: string,
  workspaceId: string,
  afterEventNumber = 0,
): string {
  return `${workspacePath(orgId, workspaceId)}/events?after=${afterEventNumber}`
}
export function chatHistoryPath(
  orgId: string,
  workspaceId: string,
  sessionId: string,
  beforeEventNumber?: number,
  throughEventNumber?: number,
): string {
  const query = new URLSearchParams({ sessionId })
  if (beforeEventNumber !== undefined)
    query.set('before', String(beforeEventNumber))
  if (throughEventNumber !== undefined)
    query.set('through', String(throughEventNumber))
  return `${workspacePath(orgId, workspaceId)}/history?${query}`
}

export type WorkspaceEvent =
  | ChatEvent
  | FileEvent
  | PortsUpdated
  | {
      type: 'workspace.updated'
      workspace: Workspace
      error?: Pick<
        NonNullable<WorkspaceResponse['error']>,
        'code' | 'message'
      > | null
    }
  | { type: 'workspace.title'; name: string }
  | { type: 'start.updated'; start: WorkspaceStart }
  | {
      type: 'github.updated'
      banner: GitHubBanner
      checks: GitHubChecksResponse
    }
  | { type: 'preview.revoked'; previewId: string }

/** The workspace assigns contiguous event numbers, starting at 1. */
export interface WorkspaceEventEnvelope {
  workspaceId: string
  eventNumber: number
  occurredAt: Timestamp
  event: WorkspaceEvent
  /** Only the workspace marks an agent event whose turn already ended. */
  late?: true
}

interface ChatHistoryPage {
  events: readonly WorkspaceEventEnvelope[]
  /** All pages together hold the state through this fixed snapshot number. */
  throughEventNumber: number
}

export type ChatHistoryResponse = ChatHistoryPage &
  (
    | { hasMore: true; nextAfterEventNumber: number }
    | { hasMore?: never; nextAfterEventNumber?: never }
  )

export type NewestChatHistoryResponse = ChatHistoryPage & {
  nextAfterEventNumber?: never
} & (
    | { hasMore: true; nextBeforeEventNumber: number }
    | { hasMore?: never; nextBeforeEventNumber?: never }
  )

export type WorkspaceSocketMessage =
  | { type: 'history'; history: ChatHistoryResponse }
  | { type: 'event'; envelope: WorkspaceEventEnvelope }
