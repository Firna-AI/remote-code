import type { TranscriptDetail } from '../../shared/generated/TranscriptDetail'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { ApiClient } from '../../app/api/client'
import { readWorkspaces } from '../../app/api/read-workspaces'
import { uploadAttachment } from '../../app/attachment-upload'
import type { UploadHooks } from '../../app/draft-files'
import { ACCOUNT_PATHS } from '../../shared/account'
import { MODELS_PATH } from '../../shared/agents'
import { orgPath, type EmptyRequest } from '../../shared/api'
import { chatHistoryPath } from '../../shared/events'
import { membersPath } from '../../shared/members'
import type { SendMessageRequest } from '../../shared/messages'
import {
  retryMessagePath,
  sessionPath,
  sessionTranscriptPath,
  sessionPaths,
  sessionsPath,
  type ChangeModelRequest,
  type CloseSessionRequest,
  type CreateSessionRequest,
  type InterruptRequest,
  type RenameSessionRequest,
} from '../../shared/sessions'
import {
  workspaceViewPath,
  type UpdateWorkspaceViewRequest,
} from '../../shared/workspace-view'
import {
  workspacePath,
  workspacePaths,
  workspacesPath,
} from '../../shared/workspaces'
import {
  readAccount,
  readChangeModel,
  readInterrupt,
  readMembers,
  readModels,
  readOrg,
  readSendResponse,
  readSessionResponse,
  readSessions,
  readTranscript,
  readView,
  readViewReply,
} from './read-responses'
import { readNewestStoredEvents, readWorkspaceResponse } from './read-workspace'

export interface WorkspaceTarget {
  orgId: string
  workspaceId: string
}

const empty: EmptyRequest = {}

/**
 * The chat routes of one workspace, through the shared route builders and
 * the JSON client of the app. A failure throws the client's `ApiError`, with
 * the Worker's code and product message.
 */
export function createChatApi(client: ApiClient, target: WorkspaceTarget) {
  const { orgId, workspaceId } = target
  const session = (id: string) => sessionPath(orgId, workspaceId, id)
  const routes = (id: string) => ({
    close: sessionPaths.close(orgId, workspaceId, id),
    reopen: sessionPaths.reopen(orgId, workspaceId, id),
    messages: sessionPaths.messages(orgId, workspaceId, id),
    interrupt: sessionPaths.interrupt(orgId, workspaceId, id),
    model: sessionPaths.model(orgId, workspaceId, id),
  })

  return {
    transcript: (sessionId: string, detail: TranscriptDetail) =>
      client.get(
        sessionTranscriptPath(orgId, workspaceId, sessionId, detail),
        readTranscript,
      ),
    workspace: () =>
      client.get(workspacePath(orgId, workspaceId), readWorkspaceResponse),
    /** The visible workspaces of the org, including archived workspaces. */
    workspaces: () => client.get(workspacesPath(orgId), readWorkspaces),
    resume: () =>
      client.send(
        'POST',
        workspacePaths.resume(orgId, workspaceId),
        empty,
        readWorkspaceResponse,
      ),
    sessions: () => client.get(sessionsPath(orgId, workspaceId), readSessions),
    /**
     * One newest-first page of a session's history. A later page names the
     * cutoff of the first page, so all pages hold the state through it.
     */
    history: (sessionId: string, before?: number, through?: number) =>
      client.get(
        chatHistoryPath(orgId, workspaceId, sessionId, before, through),
        readNewestStoredEvents,
      ),
    /** The saved view, with the routine of a run workspace. */
    view: () =>
      client.get(workspaceViewPath(orgId, workspaceId), readViewReply),
    saveView: (view: UpdateWorkspaceViewRequest) =>
      client.send('PUT', workspaceViewPath(orgId, workspaceId), view, readView),
    models: () => client.get(MODELS_PATH, readModels),
    account: () => client.get(ACCOUNT_PATHS.account, readAccount),
    org: () => client.get(orgPath(orgId), readOrg),
    /** The members of the org, so the chat names the member who pressed Stop. */
    members: () => client.get(membersPath(orgId), readMembers),
    createSession: (choice: AgentChoice) =>
      client.send(
        'POST',
        sessionsPath(orgId, workspaceId),
        { choice } satisfies CreateSessionRequest,
        readSessionResponse,
      ),
    renameSession: (id: string, title: string) =>
      client.send(
        'PATCH',
        session(id),
        { title } satisfies RenameSessionRequest,
        readSessionResponse,
      ),
    closeSession: (id: string, stopRunningTurn: boolean) =>
      client.send(
        'POST',
        routes(id).close,
        { stopRunningTurn } satisfies CloseSessionRequest,
        readSessionResponse,
      ),
    reopenSession: (id: string) =>
      client.send('POST', routes(id).reopen, empty, readSessionResponse),
    send: (id: string, request: SendMessageRequest) =>
      client.send('POST', routes(id).messages, request, readSendResponse),
    retry: (id: string, messageId: string) =>
      client.send(
        'POST',
        retryMessagePath(orgId, workspaceId, id, messageId),
        empty,
        readSendResponse,
      ),
    interrupt: (id: string, turnId: string) =>
      client.send(
        'POST',
        routes(id).interrupt,
        { turnId } satisfies InterruptRequest,
        readInterrupt,
      ),
    changeModel: (id: string, request: ChangeModelRequest) =>
      client.send('PUT', routes(id).model, request, readChangeModel),
    /** Uploads one file of a draft through the one upload operation. */
    upload: (file: File, hooks: UploadHooks) =>
      uploadAttachment({
        api: client,
        orgId,
        target: { type: 'workspace', workspaceId },
        file,
        ...hooks,
      }),
  }
}

export type ChatApi = ReturnType<typeof createChatApi>
