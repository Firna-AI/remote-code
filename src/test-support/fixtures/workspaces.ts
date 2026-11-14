import type { GitHubSummary } from '../../shared/generated/GitHubSummary'
import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import type { MessageSender } from '../../shared/generated/MessageSender'
import type { UserMessage } from '../../shared/generated/UserMessage'
import { defaultChoice } from '../../../docs/mockups/src/fixtures/agents'
import {
  closedSessions,
  workspaceSessions,
} from '../../../docs/mockups/src/fixtures/sessions'
import { workspaceList } from '../../../docs/mockups/src/fixtures/workspaces'
import type { User } from '../../shared/api'

import type { SessionsResponse } from '../../shared/sessions'
import type { WorkspaceViewResponse } from '../../shared/workspace-view'
import type {
  CreateWorkspaceResponse,
  OrderedWorkspaceResponse,
  WorkspacesResponse,
} from '../../shared/workspaces'
import { FAKE_IDS, FAKE_ORIGIN, FAKE_TIME, fakeUser, fakeUsers } from './core'
import { routes } from '../../app/router'

/**
 * The snapshot of a person that a session keeps as its starter: the member
 * who created it. It stays as it was when the person leaves the org.
 */
export function senderSnapshot(person: MessageSender): MessageSender {
  const { id, githubLogin, displayName, avatarUrl } = person
  return { id, githubLogin, displayName, avatarUrl }
}

const personNamed = (key: string): User =>
  fakeUsers.find((user) => user.id === key) ?? fakeUser

/**
 * The workspaces of Acme, with `checkout-autocomplete` in `state`. Each
 * workspace has the GitHub state of its mockup workspace, unless `github`
 * gives the one of `checkout-autocomplete`, also `null`.
 */
export function workspaceFixtures(
  state: WorkspaceState = 'ready',
  github?: GitHubSummary | null,
) {
  const workspaces: WorkspacesResponse = {
    workspaces: workspaceList.map((workspace, index) => {
      const open = workspace.key === FAKE_IDS.workspace
      const archived = open && state === 'archived'
      return {
        id: workspace.key,
        number: workspace.number,
        link: new URL(
          routes.workspace(FAKE_IDS.org, workspace.key),
          FAKE_ORIGIN,
        ).href,
        orgId: FAKE_IDS.org,
        repositoryId: workspace.repository,
        sectionId: workspace.section,
        owner:
          fakeUsers.find((user) => user.id === workspace.owner) ?? fakeUser,
        name: workspace.name,
        branch: workspace.branch,
        choice: { ...workspace.choice, fast: workspace.choice.fast ?? false },
        state: open ? state : workspace.status,
        github: open && github !== undefined ? github : workspace.github,
        createdAt: FAKE_TIME - (index + 1) * 86_400_000,
        // Archive raises the time of the record to its own time, as the
        // Worker does, so the archived record is newer than each record of
        // the workspace from before the Archive.
        updatedAt: archived ? FAKE_TIME : FAKE_TIME - index * 60_000,
        restoreUntil: null,
        archivedAt: archived ? FAKE_TIME : null,
      }
    }),
  }
  const workspace = workspaces.workspaces.find(
    (item) => item.id === FAKE_IDS.workspace,
  )
  if (!workspace) throw new Error('The workspace fixture is missing.')
  // The read of the workspace. It holds the state before the events that a
  // test sends, so each sent event is newer.
  const detail: OrderedWorkspaceResponse = {
    eventNumber: 0,
    workspace,
    start:
      state === 'starting'
        ? {
            kind: 'resume',
            startedAt: FAKE_TIME - 3_000,
            steps: [
              {
                id: 'restore',
                label: 'Resuming with your files as you left them',
                state: 'running',
                startedAt: FAKE_TIME - 3_000,
                completedAt: null,
              },
            ],
          }
        : null,
    error:
      state === 'error'
        ? {
            code: 'start_failed',
            message: 'The cloud computer did not start. Try again.',
            log: null,
          }
        : null,
  }
  const sessions: SessionsResponse = {
    // The fake's records hold the state before the events that a test sends.
    eventNumber: 0,
    sessions: workspaceSessions.map((session, index) => ({
      id: session.key,
      workspaceId: workspace.id,
      title: session.title,
      choice: { ...defaultChoice, fast: defaultChoice.fast ?? false },
      createdAt: FAKE_TIME - (index + 1) * 60_000,
      closedAt: null,
      activeTurnId: state === 'working' ? 'turn-1' : null,
      activeTurnStartedAt: state === 'working' ? FAKE_TIME : null,
      retryMessageId: null,
      startedBy: senderSnapshot(personNamed(session.starter)),
      sourceSessionId: null,
      loginAvailable: true,
      loginShared: true,
    })),
    history: closedSessions.map((session, index) => ({
      id: session.key,
      workspaceId: workspace.id,
      title: session.title,
      choice:
        session.agent === 'codex'
          ? {
              agent: 'codex',
              model: 'GPT-6.1 Sol',
              effort: 'medium',
              fast: false,
            }
          : { ...defaultChoice, fast: defaultChoice.fast ?? false },
      createdAt: FAKE_TIME - (index + 2) * 86_400_000,
      closedAt: FAKE_TIME - (index + 1) * 86_400_000,
      activeTurnId: null,
      activeTurnStartedAt: null,
      retryMessageId: null,
      // The mockups name no starter of a closed session: the owner started it.
      startedBy: senderSnapshot(workspace.owner),
      sourceSessionId: null,
      loginAvailable: true,
      loginShared: true,
    })),
  }
  const message: UserMessage = {
    id: 'ask',
    sessionId: FAKE_IDS.session,
    sender: fakeUser,
    text: 'Add address autocomplete to the checkout form. Keep the manual fields as a fallback.',
    attachments: [],
    choice: { ...defaultChoice, fast: defaultChoice.fast ?? false },
    createdAt: FAKE_TIME,
    state: 'sent',
  }
  // A new workspace has no name until its title comes. Its branch has a
  // city name.
  const createdWorkspace: Workspace = {
    ...workspace,
    id: 'saved-carts',
    number: Math.max(...workspaces.workspaces.map(({ number }) => number)) + 1,
    link: new URL(routes.workspace(FAKE_IDS.org, 'saved-carts'), FAKE_ORIGIN)
      .href,
    name: null,
    branch: 'calummoore/lisbon-7k2q',
    sectionId: 'general',
    state: 'starting',
    github: null,
    createdAt: FAKE_TIME,
    updatedAt: FAKE_TIME,
  }
  const created: CreateWorkspaceResponse = {
    workspace: createdWorkspace,
    sessionId: 'new',
    firstMessage: {
      ...message,
      sessionId: 'new',
      state: 'queued',
      text: 'Let signed-in shoppers save their cart and restore it on another device.',
    },
    error: null,
    start: {
      kind: 'create',
      startedAt: FAKE_TIME,
      steps: [
        {
          id: 'image',
          label: 'Starting from the cloud computer of Acme',
          state: 'running',
          startedAt: FAKE_TIME,
          completedAt: null,
        },
      ],
    },
  }
  const view: WorkspaceViewResponse = {
    view: {
      tabs: sessions.sessions.map((session) => ({
        kind: 'session',
        sessionId: session.id,
      })),
      activeTab: { kind: 'session', sessionId: FAKE_IDS.session },
      fileList: 'changes',
      temporaryTab: null,
      tool: 'terminal',
    },
  }
  return { workspaces, detail, sessions, message, created, view }
}
