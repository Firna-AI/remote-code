import type { AgentWorkspaceSummary } from '../../src/shared/generated/AgentWorkspaceSummary'
import type { AgentListSessionsResponse } from '../../src/shared/generated/AgentListSessionsResponse'
import type { AgentReadSessionRequest } from '../../src/shared/generated/AgentReadSessionRequest'
import type { AgentReadSessionResponse } from '../../src/shared/generated/AgentReadSessionResponse'
import type { AgentCreateSessionRequest } from '../../src/shared/generated/AgentCreateSessionRequest'
import type { AgentSendMessageRequest } from '../../src/shared/generated/AgentSendMessageRequest'
import type { AgentSessionWriteResponse } from '../../src/shared/generated/AgentSessionWriteResponse'
import type { AgentSessionResponse } from '../../src/shared/generated/AgentSessionResponse'
import type { AgentStopSessionResponse } from '../../src/shared/generated/AgentStopSessionResponse'
import type { AgentGetMessageResponse } from '../../src/shared/generated/AgentGetMessageResponse'
import type { AgentListSessionsRequest } from '../../src/shared/generated/AgentListSessionsRequest'
import type { AgentRenameSessionRequest } from '../../src/shared/generated/AgentRenameSessionRequest'
import type { AgentCloseSessionRequest } from '../../src/shared/generated/AgentCloseSessionRequest'
import type { AgentCreateWorkspaceResponse } from '../../src/shared/generated/AgentCreateWorkspaceResponse'
import type { AgentRenameWorkspaceRequest } from '../../src/shared/generated/AgentRenameWorkspaceRequest'
import type { AgentMoveWorkspaceRequest } from '../../src/shared/generated/AgentMoveWorkspaceRequest'
import type { AgentModel } from '../../src/shared/generated/AgentModel'
import type { AgentCreateSectionRequest } from '../../src/shared/generated/AgentCreateSectionRequest'
import type { AgentCreateSectionResponse } from '../../src/shared/generated/AgentCreateSectionResponse'
import type { AgentDeleteSectionResponse } from '../../src/shared/generated/AgentDeleteSectionResponse'
import type { AgentListPreviewsResponse } from '../../src/shared/generated/AgentListPreviewsResponse'
import type { AgentOpenPreviewResponse } from '../../src/shared/generated/AgentOpenPreviewResponse'
import type { AgentClosePreviewResponse } from '../../src/shared/generated/AgentClosePreviewResponse'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { MessageSender } from '../../src/shared/generated/MessageSender'

import type { User } from '../../src/shared/api'

export type ToolSectionWrite = { orgId: string; senderUserId: string } & (
  | ({ kind: 'create' } & AgentCreateSectionRequest)
  | { kind: 'delete'; sectionId: string }
)

export type ToolPreviewCall = { orgId: string; workspaceId: string } & (
  | { kind: 'list' }
  | { kind: 'open'; senderUserId: string; port: unknown }
  | { kind: 'close'; senderUserId: string; previewId: string }
)

export interface ToolWorkspaceCreation {
  orgId: string
  owner: MessageSender
  repositoryId: string
  sectionId: string
  choice: AgentChoice
  firstMessage: string
  firstMessageId: string
  firstSessionTitle?: string
  name?: string
  sender: MessageSender
  createdByWorkspaceId: string
}

export interface ToolWorkspaceReplay {
  orgId: string
  senderUserId: string
  firstMessageId: string
  createdByWorkspaceId: string
}

export interface CallingTurn {
  workspaceId: string
  turnId: string
  senderUserId: string
  sessionId: string
}

export type ToolSessionWrite = {
  orgId: string
  workspaceId: string
  callerWorkspaceId: string
  callerSessionId: string
  senderUserId: string
  requestId: string
} & (
  | { kind: 'create'; input: AgentCreateSessionRequest }
  | { kind: 'send'; sessionId: string; input: AgentSendMessageRequest }
)

export type ToolSessionManagement = {
  orgId: string
  workspaceId: string
  sessionId: string
  callerWorkspaceId: string
  callerSessionId: string
  senderUserId: string
} & (
  | ({ kind: 'rename' } & AgentRenameSessionRequest)
  | ({ kind: 'close' } & Required<AgentCloseSessionRequest>)
  | { kind: 'stop' }
)

export type ToolWorkspaceWrite = {
  orgId: string
  workspaceId: string
  senderUserId: string
} & (
  | ({ kind: 'rename' } & AgentRenameWorkspaceRequest)
  | ({ kind: 'move' } & AgentMoveWorkspaceRequest)
  | { kind: 'archive' }
)

export interface ToolSessionAccess {
  user: User
  workspace: AgentWorkspaceSummary
}

/** The composition root supplies the lifecycle and the workspace's turn store. */
export interface AgentToolServices {
  writeSection(
    input: ToolSectionWrite,
  ): Promise<AgentCreateSectionResponse | AgentDeleteSectionResponse>
  previewCall(
    input: ToolPreviewCall,
  ): Promise<
    | AgentListPreviewsResponse
    | AgentOpenPreviewResponse
    | AgentClosePreviewResponse
  >
  replayWorkspaceCreation(
    input: ToolWorkspaceReplay,
  ): Promise<AgentCreateWorkspaceResponse | null>
  writeWorkspace(input: ToolWorkspaceWrite): Promise<void>
  models(): Promise<readonly AgentModel[]>
  manageSession(
    input: ToolSessionManagement,
  ): Promise<AgentSessionResponse | AgentStopSessionResponse>
  getSession(
    orgId: string,
    workspaceId: string,
    sessionId: string,
  ): Promise<AgentSessionResponse>
  getMessage(
    orgId: string,
    workspaceId: string,
    sessionId: string,
    messageId: string,
  ): Promise<AgentGetMessageResponse>
  writeSession(input: ToolSessionWrite): Promise<AgentSessionWriteResponse>
  listSessions(
    orgId: string,
    workspaceId: string,
    input?: AgentListSessionsRequest,
  ): Promise<AgentListSessionsResponse>
  readSession(
    orgId: string,
    workspaceId: string,
    sessionId: string,
    input: AgentReadSessionRequest,
  ): Promise<AgentReadSessionResponse>
  /** Return only an active turn belonging to this exact workspace and turn ID. */
  callingTurn(workspaceId: string, turnId: string): Promise<CallingTurn | null>
  /** Account policy supplies the default when no saved preference exists. */
  ownerDefaultChoice?(ownerUserId: string): Promise<AgentChoice | null>
  /**
   * Create through the normal lifecycle, using the latest good image. Keep the
   * first message durably and start it immediately as sender, not as owner.
   * Keep an accepted workspace and its first message when its sandbox cannot start.
   */
  createWorkspace(
    input: ToolWorkspaceCreation,
  ): Promise<AgentCreateWorkspaceResponse>
}
