import type { Workspace } from '../shared/generated/Workspace'
import type { WorkspaceEvent } from '../shared/events'
import {
  WORKSPACE_RESTORE_MS,
  workspacePath,
  workspacePaths,
} from '../shared/workspaces'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import { OrgModel } from './org-model'
import { valueOf } from './store'
import {
  HeldRequests,
  RecordingEvents,
  requestLines,
  testServices,
} from './test-kit'
import { WorkspaceModel } from './workspace-model'

// The helpers of the tests of Archive and Restore in the open workspace.

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace

/** The paths of the workspace that the tests write and read. */
export const paths = {
  archive: workspacePaths.archive(orgId, workspaceId),
  restore: workspacePaths.restore(orgId, workspaceId),
  resume: workspacePaths.resume(orgId, workspaceId),
  read: workspacePath(orgId, workspaceId),
}

const stopped = workspaceFixtures('stopped').detail.workspace

/** The record of an Archive at `updatedAt`. Each Archive has the same clock. */
export function archivedAt(updatedAt: number): Workspace {
  return {
    ...stopped,
    state: 'archived',
    archivedAt: FAKE_TIME,
    restoreUntil: FAKE_TIME + WORKSPACE_RESTORE_MS,
    updatedAt,
  }
}

/** The record of a Restore at `updatedAt`. */
export function restoredAt(updatedAt: number): Workspace {
  return {
    ...stopped,
    state: 'stopped',
    archivedAt: null,
    restoreUntil: null,
    updatedAt,
  }
}

/** A reply of Archive, Restore, or a read with no start and no error. */
export function reply(workspace: Workspace) {
  return { workspace, start: null, error: null }
}

/** A stopped workspace on the fake API, before its open. */
export async function stoppedWorkspace() {
  const server = new FakeApiServer({ workspaceState: 'stopped' })
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  const org = new OrgModel(
    testServices(server, { fetch: held.fetch, events }),
    orgId,
  )
  const workspace = new WorkspaceModel(org, workspaceId)
  await org.reload('list')
  let eventNumber = 0
  /** The next stored event of the workspace, with the next number. */
  const envelope = (record: Workspace) => {
    const event: WorkspaceEvent = {
      type: 'workspace.updated',
      workspace: record,
    }
    return {
      workspaceId,
      eventNumber: ++eventNumber,
      occurredAt: FAKE_TIME,
      event,
    }
  }
  /** A live event of the stream. */
  const updated = (record: Workspace) =>
    events.send({ type: 'event', envelope: envelope(record) })
  /** The stored events that a new connection replays, in one page. */
  const replay = (...records: Workspace[]) => {
    const page = records.map(envelope)
    events.send({
      type: 'history',
      history: { events: page, throughEventNumber: eventNumber },
    })
  }
  /** The states of the detail and the row. */
  const states = () => ({
    detail: valueOf(workspace.detail.get())?.workspace.state,
    row: org.workspace(workspaceId)?.state,
  })
  const resumes = () =>
    requestLines(server).filter((line) => line === `POST ${paths.resume}`)
  const streams = () => events.opened.length
  return {
    server,
    held,
    org,
    workspace,
    updated,
    replay,
    states,
    resumes,
    streams,
  }
}
