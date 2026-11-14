import { expect, test } from 'vitest'
import type { WorkspaceStart } from '../shared/generated/WorkspaceStart'
import { workspacePath, workspacePaths } from '../shared/workspaces'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import { OrgModel } from './org-model'
import { valueOf } from './store'
import { HeldRequests, RecordingEvents, testServices } from './test-kit'
import { WorkspaceModel } from './workspace-model'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const openPath = workspacePath(orgId, workspaceId)
const resumePath = workspacePaths.resume(orgId, workspaceId)
const savedError = {
  code: 'workspace_start_failed',
  message:
    'The cloud computer did not start within the 20-minute limit. Try again.',
}

function setup(server: FakeApiServer) {
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  const org = new OrgModel(
    testServices(server, { fetch: held.fetch, events }),
    orgId,
  )
  return { held, events, workspace: new WorkspaceModel(org, workspaceId) }
}

test('a live failed start keeps its saved cause and steps over an older Resume reply', async () => {
  const server = new FakeApiServer({ workspaceState: 'starting' })
  const { held, events, workspace } = setup(server)
  await workspace.open()
  const before = valueOf(workspace.detail.get())
  if (!before) throw new Error('The workspace did not open.')
  server.json('POST', resumePath, { ...before, eventNumber: 0 })
  held.holdAnswer('POST', resumePath)
  const resuming = workspace.resume()
  events.send({
    type: 'history',
    history: { events: [], throughEventNumber: 10 },
  })
  const failedWorkspace = { ...before.workspace, state: 'error' }
  const failedStart: WorkspaceStart = {
    kind: 'resume',
    startedAt: FAKE_TIME - 1_200_000,
    steps: [
      {
        id: 'startup',
        label: 'Running the startup script',
        state: 'failed',
        startedAt: FAKE_TIME - 1_199_000,
        completedAt: FAKE_TIME,
      },
    ],
  }
  events.send({
    type: 'event',
    envelope: {
      workspaceId,
      eventNumber: 11,
      occurredAt: FAKE_TIME,
      event: { type: 'start.updated', start: failedStart },
    },
  })
  const failure = {
    workspaceId,
    eventNumber: 12,
    occurredAt: FAKE_TIME,
    event: {
      type: 'workspace.updated',
      workspace: failedWorkspace,
      error: { ...savedError, log: 'private output must not enter the model' },
    },
  }
  events.send({ type: 'event', envelope: failure })
  const expected = {
    workspace: failedWorkspace,
    start: failedStart,
    error: { ...savedError, log: null },
  }
  expect(valueOf(workspace.detail.get())).toEqual(expected)
  events.send({
    type: 'event',
    envelope: {
      ...failure,
      event: { ...failure.event, error: null },
    },
  })
  held.release('POST', resumePath)
  await resuming
  expect(valueOf(workspace.detail.get())).toEqual(expected)
  expect(workspace.stream.last.get()).toBe(12)
  workspace.close()
})

test('old workspace events keep a saved error until an event explicitly clears it', async () => {
  const server = new FakeApiServer()
  const saved = {
    ...workspaceFixtures('error').detail,
    error: { ...savedError, log: 'Previously released masked output.' },
  }
  server.json('GET', openPath, saved)
  server.json('POST', resumePath, { error: savedError }, 503)
  const { events, workspace } = setup(server)
  await workspace.open()
  const before = valueOf(workspace.detail.get())
  if (!before) throw new Error('The workspace did not open.')
  const updated = { ...before.workspace, state: 'starting' }
  const legacy = {
    workspaceId,
    occurredAt: FAKE_TIME,
    eventNumber: 2,
    event: { type: 'workspace.updated', workspace: updated },
  }
  events.send({
    type: 'history',
    history: {
      events: [
        legacy,
        {
          workspaceId,
          occurredAt: FAKE_TIME,
          eventNumber: 1,
          event: { type: 'workspace.title', name: 'Earlier title' },
        },
      ],
      throughEventNumber: 2,
    },
  })
  expect(valueOf(workspace.detail.get())).toEqual({
    ...before,
    workspace: updated,
  })
  events.send({
    type: 'event',
    envelope: {
      ...legacy,
      eventNumber: 3,
      event: { ...legacy.event, error: null },
    },
  })
  expect(valueOf(workspace.detail.get())).toEqual({
    ...before,
    workspace: updated,
    error: null,
  })
  workspace.close()
})
