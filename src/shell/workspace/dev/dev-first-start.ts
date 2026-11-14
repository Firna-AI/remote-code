import type { WorkspaceStart } from '../../../shared/generated/WorkspaceStart'
import { newWorkspaceConversations } from '../../../../docs/mockups/src/fixtures/newWorkspaceConversations'
import { startErrors } from '../../../../docs/mockups/src/fixtures/starting'
import {
  chatHistoryPath,
  type WorkspaceEventEnvelope,
} from '../../../shared/events'
import { workspacePath, workspacesPath } from '../../../shared/workspaces'
import type { FakeApiServer } from '../../../test-support/fake-api'
import { fakeGitHub } from '../../../test-support/fake-tool-routes'
import {
  FAKE_IDS,
  FAKE_TIME,
  fakeUsers,
} from '../../../test-support/fixtures/core'
import { workspaceFixtures } from '../../../test-support/fixtures/workspaces'

/**
 * The states of a new workspace around its first start, as the mockups of
 * `app/new-workspace` draw them. Development only.
 */
export const firstStartStates = [
  'waiting',
  'failed',
  'time-limit',
  'retrying',
] as const

export type FirstStartState = (typeof firstStartStates)[number]

/** The create start, with its running step failed when the start failed. */
function startOf(start: WorkspaceStart, failed: boolean): WorkspaceStart {
  if (!failed) return start
  const steps = start.steps.map((step) =>
    step.state === 'running'
      ? { ...step, state: 'failed' as const, completedAt: FAKE_TIME }
      : step,
  )
  return { ...start, steps }
}

/**
 * Seeds the fake API with the new workspace of the create flow in a state
 * of its first start, with the queued messages of the mockups, and returns
 * its ID. `member` signs in Priya, a member who is not the owner. The
 * Worker sets these states, so the fake records them. Development only.
 */
export function seedFirstStart(
  server: FakeApiServer,
  state: FirstStartState,
  member: boolean,
): string {
  const org = FAKE_IDS.org
  const { created, workspaces, message } = workspaceFixtures()
  const { start } = created
  if (!start) throw new Error('The created workspace has no start.')
  const id = created.workspace.id
  const failed = state === 'failed' || state === 'time-limit'
  const workspace = {
    ...created.workspace,
    state: failed ? ('error' as const) : ('starting' as const),
  }
  server.json('GET', workspacesPath(org), {
    workspaces: [workspace, ...workspaces.workspaces],
  })
  server.json('GET', workspacePath(org, id), {
    workspace,
    start: startOf(start, failed),
    error: failed
      ? {
          code: 'workspace_start_failed',
          message: startErrors[state === 'failed' ? 'failed' : 'time-limit'],
          log: null,
        }
      : null,
    eventNumber: 0,
  })
  const queued =
    newWorkspaceConversations[
      state === 'retrying' ? 'queued-retry' : 'queued-follow-up'
    ]
  const events = queued.map((item, index): WorkspaceEventEnvelope => ({
    workspaceId: id,
    eventNumber: index + 1,
    occurredAt: FAKE_TIME + index * 1_000,
    event: {
      type: 'message.accepted',
      message: {
        ...message,
        id: item.id,
        sessionId: created.sessionId,
        text: item.text,
        state: 'queued',
      },
    },
  }))
  server.json('GET', chatHistoryPath(org, id, created.sessionId), {
    events,
    throughEventNumber: events.length,
  })
  fakeGitHub(server, id, 'no-commits', created.workspace.branch)
  if (member) server.signIn(fakeUsers[1])
  return id
}
