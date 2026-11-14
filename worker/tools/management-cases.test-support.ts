import {
  agentPreviewClosePath,
  agentPreviewsPath,
} from '../../src/shared/agent-previews'
import { agentSectionDeletePath } from '../../src/shared/agent-sections'
import {
  agentMessagePath,
  agentSessionPath,
  agentSessionPaths,
  agentSessionsPath,
} from '../../src/shared/agent-session-paths'
import { MACHINE_PATHS } from '../../src/shared/agent-tools'
import {
  agentWorkspacePath,
  agentWorkspacePaths,
} from '../../src/shared/agent-workspaces'

interface ToolRouteCase {
  name: string
  path: string
  body?: Record<string, unknown>
  query?: Record<string, string>
  reply: object
}

const workspaceId = 'teammate-workspace'
const sessionId = 'session / one'
const messageId = 'message / one'
const previewId = 'preview / one'

export const TOOL_ROUTE_CASES: readonly ToolRouteCase[] = [
  {
    name: 'get_workspace',
    path: agentWorkspacePath(),
    reply: {
      workspace: {
        id: 'calling-workspace',
        owner: { id: 'owner', githubLogin: 'owner-login', displayName: null },
        repository: { id: 'repo-a' },
        section: { id: 'general-a' },
        baseBranch: 'main',
      },
    },
  },
  {
    name: 'rename_workspace',
    path: agentWorkspacePaths.rename(workspaceId),
    body: { name: 'New name' },
    reply: { workspace: { id: workspaceId } },
  },
  {
    name: 'move_workspace',
    path: agentWorkspacePaths.move(workspaceId),
    body: { sectionId: 'chosen-a' },
    reply: { workspace: { id: workspaceId } },
  },
  {
    name: 'archive_workspace',
    path: agentWorkspacePaths.archive(workspaceId),
    body: {},
    reply: { workspace: { id: workspaceId } },
  },
  {
    name: 'get_session',
    path: agentSessionPath(workspaceId, sessionId),
    reply: { session: { id: sessionId, closed: false, state: 'idle' } },
  },
  {
    name: 'rename_session',
    path: agentSessionPaths.rename(workspaceId, sessionId),
    body: { title: 'New title' },
    reply: { session: { id: sessionId } },
  },
  {
    name: 'close_session',
    path: agentSessionPaths.close(workspaceId, sessionId),
    body: { stopRunningTurn: true },
    reply: { session: { id: sessionId, closed: true } },
  },
  {
    name: 'stop_session',
    path: agentSessionPaths.stop(workspaceId, sessionId),
    body: {},
    reply: { session: { id: sessionId }, state: 'idle', turnId: null },
  },
  {
    name: 'get_message',
    path: agentMessagePath(workspaceId, sessionId, messageId),
    reply: {
      message: { id: messageId, text: 'Exact message\r\n\n' },
      turnId: null,
    },
  },
  {
    name: 'create_section',
    path: MACHINE_PATHS.sections,
    body: { name: 'Reviews' },
    reply: { section: { id: 'new-section', name: 'Reviews', default: false } },
  },
  {
    name: 'delete_section',
    path: agentSectionDeletePath('general-a'),
    body: {},
    reply: { deleted: false },
  },
  {
    name: 'list_previews',
    path: agentPreviewsPath(workspaceId),
    reply: { previews: [{ id: previewId, port: 4321 }] },
  },
  {
    name: 'open_preview',
    path: agentPreviewsPath(workspaceId),
    body: { port: 4321 },
    reply: { preview: { id: previewId, port: 4321 } },
  },
  {
    name: 'close_preview',
    path: agentPreviewClosePath(workspaceId, previewId),
    body: {},
    reply: { closed: false },
  },
  {
    name: 'list_workspaces',
    path: MACHINE_PATHS.workspaces,
    query: {
      ownerId: 'teammate',
      state: 'ready',
      repositoryId: 'repo-a',
      query: 'Par',
      updatedSince: '-1',
      archived: 'false',
      limit: '1',
      offset: '0',
    },
    reply: {
      workspaces: [
        {
          id: workspaceId,
          owner: {
            id: 'teammate',
            githubLogin: 'teammate-login',
            displayName: null,
          },
        },
      ],
      hasMore: false,
    },
  },
  {
    name: 'list_workspaces',
    path: MACHINE_PATHS.workspaces,
    query: { archived: 'true' },
    reply: { workspaces: [{ id: 'archived-workspace' }] },
  },
  {
    name: 'list_sessions',
    path: agentSessionsPath(workspaceId),
    query: { limit: '1', offset: '2' },
    reply: { sessions: [{ id: sessionId }], hasMore: true },
  },
  {
    name: 'create_workspace',
    path: MACHINE_PATHS.workspaces,
    body: {
      repositoryId: 'repo-a',
      firstMessage: 'Start',
      firstSessionTitle: 'First title',
      requestId: 'stable-create',
    },
    reply: {
      workspace: { id: 'created-workspace' },
      sessionId: 'created-session',
    },
  },
]
