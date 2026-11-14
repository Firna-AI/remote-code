import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import { expect, test } from 'vitest'
import type { WorkspaceEvent } from '../shared/events'
import { workspacePaths } from '../shared/workspaces'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import { OrgModel } from './org-model'
import { valueOf } from './store'
import {
  flushMicrotasks,
  HeldRequests,
  ManualDelay,
  ManualVisibility,
  RecordingEvents,
  testServices,
} from './test-kit'
import { WorkspaceModel } from './workspace-model'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const readPath = workspacePaths.read(orgId, workspaceId)

function setup(state: WorkspaceState = 'unread') {
  const server = new FakeApiServer({ workspaceState: state })
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  const delay = new ManualDelay()
  const visible = new ManualVisibility()
  const org = new OrgModel(
    testServices(server, {
      fetch: held.fetch,
      events,
      delay: delay.delay,
      visible,
    }),
    orgId,
  )
  const workspace = new WorkspaceModel(org, workspaceId)
  const marks = () =>
    Promise.all(
      server.requests
        .filter(
          (request) =>
            request.method === 'PUT' &&
            new URL(request.url).pathname === readPath,
        )
        .map((request) => request.clone().json()),
    )
  const envelope = (eventNumber: number, event: WorkspaceEvent) => ({
    workspaceId,
    eventNumber,
    occurredAt: FAKE_TIME,
    event,
  })
  const update = (eventNumber: number, next: WorkspaceState) =>
    envelope(eventNumber, {
      type: 'workspace.updated',
      workspace: workspaceFixtures(next).detail.workspace,
    })
  const history = (throughEventNumber: number) =>
    events.send({
      type: 'history',
      history: { events: [], throughEventNumber },
    })
  return {
    server,
    held,
    events,
    delay,
    visible,
    org,
    workspace,
    marks,
    update,
    history,
  }
}

test('a hidden page cancels its retry and marks the newest event when shown', async () => {
  const { server, events, delay, visible, workspace, marks, update, history } =
    setup()
  server.json(
    'PUT',
    readPath,
    { error: { code: 'busy', message: 'Busy.' } },
    503,
  )
  await workspace.open()
  history(4)
  await flushMicrotasks()
  expect(delay.pending).toBe(1)
  visible.set(false)
  expect(delay.pending).toBe(0)
  events.send({ type: 'event', envelope: update(5, 'working') })
  events.send({ type: 'event', envelope: update(6, 'ready') })
  await delay.runAll()
  await flushMicrotasks()
  expect(await marks()).toEqual([{ throughEventNumber: 4 }])
  expect(delay.pending).toBe(0)
  server.empty('PUT', readPath)
  visible.set(true)
  await flushMicrotasks()
  expect(await marks()).toEqual([
    { throughEventNumber: 4 },
    { throughEventNumber: 6 },
  ])
  workspace.close()
  expect(visible.listening).toBe(0)
})

test('an answer after close retains confirmation without changing detail or scheduling work', async () => {
  const { held, delay, visible, org, workspace, marks, history } = setup()
  await org.reload('list')
  held.holdAnswer('PUT', readPath)
  await workspace.open()
  history(4)
  await flushMicrotasks()
  workspace.close()
  held.release('PUT', readPath)
  await flushMicrotasks()
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('unread')
  expect(org.workspace(workspaceId)?.state).toBe('unread')
  expect(delay.pending).toBe(0)
  expect(visible.listening).toBe(0)
  await workspace.open()
  await flushMicrotasks()
  expect(await marks()).toEqual([{ throughEventNumber: 4 }])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('ready')
  expect(org.workspace(workspaceId)?.state).toBe('ready')
  workspace.close()
})

test('an archived detail sends no mark while history replays records from before archive', async () => {
  const { events, delay, visible, workspace, marks, update } = setup('archived')
  await workspace.open()
  events.send({
    type: 'history',
    history: {
      events: [update(1, 'working'), update(2, 'ready')],
      throughEventNumber: 3,
    },
  })
  visible.set(false)
  visible.set(true)
  await delay.runAll()
  await flushMicrotasks()
  expect(await marks()).toEqual([])
  expect(delay.pending).toBe(0)
  workspace.close()
})

test('archive cancels a failed mark retry and older state records cannot restart it', async () => {
  const { server, events, delay, visible, workspace, marks, update, history } =
    setup()
  server.json(
    'PUT',
    readPath,
    { error: { code: 'busy', message: 'Busy.' } },
    503,
  )
  await workspace.open()
  history(4)
  await flushMicrotasks()
  expect(delay.pending).toBe(1)
  await workspace.archive.archive()
  expect(delay.pending).toBe(0)
  events.send({ type: 'event', envelope: update(5, 'ready') })
  visible.set(false)
  visible.set(true)
  await delay.runAll()
  await flushMicrotasks()
  expect(await marks()).toEqual([{ throughEventNumber: 4 }])
  expect(delay.pending).toBe(0)
  workspace.close()
})

test('an archive event blocks a mark before the last event number can send it', async () => {
  const { events, delay, workspace, marks, update } = setup('ready')
  await workspace.open()
  events.send({ type: 'event', envelope: update(1, 'archived') })
  await flushMicrotasks()
  expect(await marks()).toEqual([])
  expect(delay.pending).toBe(0)
  workspace.close()
})

test('a Restore marks the events that came while the workspace was archived', async () => {
  const { workspace, marks, history } = setup('ready')
  await workspace.open()
  await workspace.archive.archive()
  history(3)
  await flushMicrotasks()
  const archived = await marks()
  await workspace.archive.restore()
  await flushMicrotasks()
  expect({ archived, restored: await marks() }).toEqual({
    archived: [],
    restored: [{ throughEventNumber: 3 }],
  })
  workspace.close()
})
