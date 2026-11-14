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
  RecordingEvents,
  testServices,
} from './test-kit'
import { WorkspaceModel } from './workspace-model'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const readPath = workspacePaths.read(orgId, workspaceId)

function envelope(eventNumber: number, event: WorkspaceEvent) {
  return { workspaceId, eventNumber, occurredAt: FAKE_TIME, event }
}

function update(eventNumber: number, state: WorkspaceState) {
  return envelope(eventNumber, {
    type: 'workspace.updated',
    workspace: workspaceFixtures(state).detail.workspace,
  })
}

const output: WorkspaceEvent = {
  type: 'assistant.delta',
  sessionId: FAKE_IDS.session,
  turnId: 'turn-1',
  messageId: 'answer-1',
  text: 'The answer is ready.',
}

function setup(state: WorkspaceState = 'unread') {
  const server = new FakeApiServer({ workspaceState: state })
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  const delay = new ManualDelay()
  const org = new OrgModel(
    testServices(server, { fetch: held.fetch, events, delay: delay.delay }),
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
  const history = (throughEventNumber: number) =>
    events.send({
      type: 'history',
      history: { events: [], throughEventNumber },
    })
  return { server, held, events, delay, org, workspace, marks, history }
}

test('marks live output through working and ready, and joins later numbers after the answer', async () => {
  const { held, events, delay, workspace, marks } = setup('ready')
  held.holdAnswer('PUT', readPath)
  await workspace.open()
  events.send({ type: 'event', envelope: envelope(1, output) })
  await flushMicrotasks()
  events.send({ type: 'event', envelope: update(2, 'working') })
  events.send({ type: 'event', envelope: update(3, 'ready') })
  await flushMicrotasks()
  expect(await marks()).toEqual([{ throughEventNumber: 1 }])
  expect(delay.pending).toBe(0)
  held.release('PUT', readPath)
  await flushMicrotasks()
  expect(delay.pending).toBe(1)
  expect(await marks()).toEqual([{ throughEventNumber: 1 }])
  await delay.runAll()
  await flushMicrotasks()
  expect(await marks()).toEqual([
    { throughEventNumber: 1 },
    { throughEventNumber: 3 },
  ])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('ready')
  expect(delay.pending).toBe(0)
  workspace.close()
})

test('marks the newest replayed event when old lifecycle records replace an unread detail', async () => {
  const { events, workspace, marks } = setup()
  await workspace.open()
  events.send({
    type: 'history',
    history: {
      events: [envelope(1, output), update(2, 'working'), update(3, 'ready')],
      throughEventNumber: 3,
    },
  })
  await flushMicrotasks()
  expect(await marks()).toEqual([{ throughEventNumber: 3 }])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('ready')
  workspace.close()
})

test('retries a failed mark when a reconnect keeps the same event number', async () => {
  const { server, events, delay, workspace, marks, history } = setup()
  server.json(
    'PUT',
    readPath,
    { error: { code: 'busy', message: 'Busy.' } },
    503,
  )
  await workspace.open()
  history(4)
  await flushMicrotasks()
  expect(await marks()).toEqual([{ throughEventNumber: 4 }])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('unread')
  expect(delay.pending).toBe(1)
  server.empty('PUT', readPath)
  events.drop()
  await delay.runAll()
  history(4)
  await flushMicrotasks()
  expect(events.opened.map((target) => target.afterEventNumber)).toEqual([0, 4])
  expect(await marks()).toEqual([
    { throughEventNumber: 4 },
    { throughEventNumber: 4 },
  ])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('ready')
  expect(delay.pending).toBe(0)
  workspace.close()
})

test('a held mark across reopen sends the newer mark before it clears unread in detail and list', async () => {
  const { held, events, delay, org, workspace, marks, history } = setup()
  await org.reload('list')
  held.holdAnswer('PUT', readPath)
  await workspace.open()
  history(4)
  await flushMicrotasks()
  workspace.close()
  await workspace.open()
  events.send({ type: 'event', envelope: update(5, 'unread') })
  await flushMicrotasks()
  expect(await marks()).toEqual([{ throughEventNumber: 4 }])
  held.release('PUT', readPath)
  await flushMicrotasks()
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('unread')
  expect(org.workspace(workspaceId)?.state).toBe('unread')
  expect(delay.pending).toBe(1)
  await delay.runAll()
  await flushMicrotasks()
  expect(await marks()).toEqual([
    { throughEventNumber: 4 },
    { throughEventNumber: 5 },
  ])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('ready')
  expect(org.workspace(workspaceId)?.state).toBe('ready')
  workspace.close()
})

test('reopen retries a failed mark without a new event and retains the confirmed number', async () => {
  const { server, delay, workspace, marks, history } = setup()
  server.json(
    'PUT',
    readPath,
    { error: { code: 'busy', message: 'Busy.' } },
    503,
  )
  await workspace.open()
  history(4)
  await flushMicrotasks()
  workspace.close()
  expect(delay.pending).toBe(0)
  server.empty('PUT', readPath)
  await workspace.open()
  await flushMicrotasks()
  expect(await marks()).toEqual([
    { throughEventNumber: 4 },
    { throughEventNumber: 4 },
  ])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('ready')
  workspace.close()
  await workspace.open()
  history(4)
  await flushMicrotasks()
  expect(await marks()).toEqual([
    { throughEventNumber: 4 },
    { throughEventNumber: 4 },
  ])
  expect(valueOf(workspace.detail.get())?.workspace.state).toBe('ready')
  expect(delay.pending).toBe(0)
  workspace.close()
})
