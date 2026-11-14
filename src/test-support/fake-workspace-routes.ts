import type { GitHubSummary } from '../shared/generated/GitHubSummary'
import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import type { PathState } from '../../docs/mockups/src/fixtures/maskedFiles'
import { chatHistoryPath } from '../shared/events'

import { workspaceOwnerPath } from '../shared/members'
import {
  retryMessagePath,
  sessionPath,
  sessionPaths,
  sessionsPath,
} from '../shared/sessions'
import { workspaceViewPath } from '../shared/workspace-view'
import {
  WORKSPACE_RESTORE_MS,
  workspacePath,
  workspacePaths,
  workspacesPath,
} from '../shared/workspaces'
import type { FakeRouteWriter } from './fake-api-routes'
import { FAKE_IDS, FAKE_TIME } from './fixtures/core'
import { workspaceFixtures } from './fixtures/workspaces'
import {
  maskedChangedFiles,
  withMaskedTurnFiles,
} from './fixtures/masked-paths'
import { recordedChatEvents, type RecordedChatScenario } from './recorded-chat'

/**
 * The recorded chats whose turn still runs at their end. Each session record
 * names that turn and its start, as the Worker does.
 */
const runningAtEnd: ReadonlySet<RecordedChatScenario> = new Set([
  'running',
  'first-turn',
  'refused-events',
])

/**
 * The event number of each recorded reply and read. The recorded state
 * holds before the events that a test sends, so each sent event is newer.
 */
const eventNumber = 0

export function fakeWorkspaceRoutes(
  routes: FakeRouteWriter,
  state: WorkspaceState,
  conversation: RecordedChatScenario,
  paths: PathState = 'plain',
  /** The GitHub state of the default workspace, as `workspaceFixtures` takes it. */
  github?: GitHubSummary | null,
) {
  const data = workspaceFixtures(state, github)
  const org = FAKE_IDS.org
  routes.json('GET', workspacesPath(org), data.workspaces)
  routes.json('POST', workspacesPath(org), data.created, 201)
  for (const workspace of [
    ...data.workspaces.workspaces,
    data.created.workspace,
  ]) {
    const id = workspace.id
    const detail =
      workspace.id === data.created.workspace.id
        ? data.created
        : { ...data.detail, workspace }
    const running = runningAtEnd.has(conversation)
    const sessions = {
      eventNumber,
      sessions: data.sessions.sessions.map((session) => ({
        ...session,
        workspaceId: id,
        activeTurnId: running ? 'turn-1' : session.activeTurnId,
        activeTurnStartedAt: running ? FAKE_TIME : session.activeTurnStartedAt,
        retryMessageId: conversation === 'failed' ? data.message.id : null,
      })),
      history: data.sessions.history.map((session) => ({
        ...session,
        workspaceId: id,
      })),
    }
    if (workspace.id === data.created.workspace.id) {
      // The first session of a new workspace has no title until the title of
      // the workspace comes.
      sessions.sessions = [
        {
          ...sessions.sessions[0],
          id: data.created.sessionId,
          title: null,
          activeTurnId: null,
          activeTurnStartedAt: null,
          retryMessageId: null,
        },
      ]
      sessions.history = []
    }
    // A read and a Resume carry the order of their state. A create, a
    // rename, and an Archive do not.
    const reply = {
      workspace: detail.workspace,
      start: detail.start,
      error: detail.error,
    }
    const ordered = { ...reply, eventNumber }
    routes.json('GET', workspacePath(org, id), ordered)
    routes.json('PATCH', workspacePath(org, id), reply)
    routes.json('POST', workspacePaths.resume(org, id), ordered)
    routes.empty('POST', workspacePaths.activity(org, id))
    routes.empty('PUT', workspacePaths.read(org, id))
    // Archive keeps the cloud computer for the days of Restore. Archive and
    // Restore raise the time of the record past the time of each record
    // before them, as the Worker does, so the app orders each one after the
    // state before it, and a Restore after the Archive.
    const changedAt = Math.max(FAKE_TIME, workspace.updatedAt)
    routes.json('POST', workspacePaths.archive(org, id), {
      workspace: {
        ...workspace,
        state: 'archived',
        archivedAt: FAKE_TIME,
        restoreUntil: FAKE_TIME + WORKSPACE_RESTORE_MS,
        updatedAt: changedAt + 1,
      },
      start: null,
      error: null,
    })
    routes.json('POST', workspacePaths.restore(org, id), {
      workspace: {
        ...workspace,
        state: 'stopped',
        archivedAt: null,
        restoreUntil: null,
        updatedAt: changedAt + 2,
      },
      start: null,
      error: null,
    })
    routes.json('PUT', workspaceOwnerPath(org, id), { workspace })
    routes.json('GET', workspaceViewPath(org, id), data.view)
    routes.json('PUT', workspaceViewPath(org, id), data.view)
    routes.json('GET', sessionsPath(org, id), sessions)
    routes.json(
      'POST',
      sessionsPath(org, id),
      { session: sessions.sessions[0], eventNumber },
      201,
    )
    for (const session of [...sessions.sessions, ...sessions.history]) {
      const message = { ...data.message, sessionId: session.id }
      const reply = { session, eventNumber }
      routes.json('PATCH', sessionPath(org, id, session.id), reply)
      routes.json('POST', sessionPaths.close(org, id, session.id), reply)
      routes.json('POST', sessionPaths.reopen(org, id, session.id), reply)
      routes.json('PUT', sessionPaths.model(org, id, session.id), {
        ...reply,
        created: false,
        draft: { text: '', attachmentIds: [] },
      })
      // A reply names the session where the message went: here its own.
      routes.json(
        'POST',
        sessionPaths.messages(org, id, session.id),
        { message, turnId: 'turn-1', ...reply },
        202,
      )
      routes.json(
        'POST',
        retryMessagePath(org, id, session.id, data.message.id),
        { message, turnId: 'turn-1', ...reply },
        202,
      )
      routes.json('POST', sessionPaths.interrupt(org, id, session.id), {
        turnId: 'turn-1',
        state: 'stopping',
        eventNumber,
      })
      const recorded = recordedChatEvents(conversation, id, session.id)
      const events =
        paths === 'masked'
          ? withMaskedTurnFiles(recorded, maskedChangedFiles())
          : recorded
      routes.json('GET', chatHistoryPath(org, id, session.id), {
        events,
        throughEventNumber: events.at(-1)?.eventNumber ?? 0,
      })
    }
  }
}
