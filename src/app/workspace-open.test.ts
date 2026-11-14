import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import { expect, test } from 'vitest'
import { workspacePaths } from '../shared/workspaces'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import { ApiError } from './api/client'
import { OrgModel } from './org-model'
import { valueOf } from './store'
import {
  flushMicrotasks,
  HeldRequests,
  RecordingEvents,
  testServices,
} from './test-kit'
import { WorkspaceModel } from './workspace-model'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const resumePath = workspacePaths.resume(orgId, workspaceId)
const refused = new ApiError(403, 'user_suspended', 'The owner is suspended.')
const nextOwner = {
  id: 'new-owner',
  githubLogin: 'new-owner',
  displayName: 'New owner',
  avatarUrl: null,
}

function setup(state: WorkspaceState, initialError: ApiError) {
  const server = new FakeApiServer({ workspaceState: state })
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  let problem: ApiError | null = initialError
  let beforeStart: { state: string; streams: number } | null = null
  let duringStart: () => void = () => undefined
  const org = new OrgModel(
    testServices(server, {
      events,
      fetch: async (input, init) => {
        if (init?.method === 'POST') {
          beforeStart = {
            state: workspace.detail.get().state,
            streams: events.opened.length,
          }
          duringStart()
        }
        const response = await held.fetch(input, init)
        return init?.method === 'POST' && problem
          ? Response.json(
              { error: { code: problem.code, message: problem.message } },
              { status: problem.status },
            )
          : response
      },
    }),
    orgId,
  )
  const workspace = new WorkspaceModel(org, workspaceId)
  return {
    server,
    held,
    events,
    workspace,
    beforeStart: () => beforeStart,
    duringStart: (run: () => void) => {
      duringStart = run
    },
    allowStart: () => {
      problem = null
    },
  }
}

test('opens detail and history before a refused start, and scopes the refusal to its owner', async () => {
  const fixture = setup('stopped', refused)
  const { held, events, workspace } = fixture
  const history: string[] = []
  workspace.stream.subscribe((event) => history.push(event.type))
  fixture.duringStart(() => {
    events.send({
      type: 'history',
      history: {
        events: [
          {
            workspaceId,
            eventNumber: 1,
            occurredAt: FAKE_TIME,
            event: { type: 'workspace.title', name: 'Title from history' },
          },
        ],
        throughEventNumber: 1,
      },
    })
  })
  held.holdAnswer('POST', resumePath)
  const opening = workspace.open()
  await flushMicrotasks()
  expect(workspace.detail.get()).toMatchObject({
    state: 'ready',
    value: { workspace: { name: 'Title from history', state: 'stopped' } },
  })
  expect(fixture.beforeStart()).toEqual({ state: 'ready', streams: 1 })
  expect(history).toEqual(['workspace.title'])
  held.release('POST', resumePath)
  await opening
  expect(workspace.startError.get()).toMatchObject({ code: 'user_suspended' })
  const current = valueOf(workspace.detail.get())?.workspace
  if (!current) throw new Error('The workspace did not stay open.')
  const update = (eventNumber: number, owner: typeof current.owner) =>
    events.send({
      type: 'event',
      envelope: {
        workspaceId,
        eventNumber,
        occurredAt: FAKE_TIME,
        event: { type: 'workspace.updated', workspace: { ...current, owner } },
      },
    })
  update(2, { ...current.owner, displayName: 'Updated display name' })
  expect(workspace.startError.get()).toMatchObject({ code: 'user_suspended' })
  update(3, nextOwner)
  expect(workspace.startError.get()).toBe(null)
  expect(valueOf(workspace.detail.get())?.workspace.owner).toEqual(nextOwner)
  expect(history).toEqual([
    'workspace.title',
    'workspace.updated',
    'workspace.updated',
  ])
  workspace.close()
})

test('a confirmed owner reply clears the refusal and keeps the current detail fields', async () => {
  const fixture = setup('stopped', refused)
  const { events, workspace, held, server } = fixture
  await workspace.open()
  expect(workspace.startError.get()).toMatchObject({ code: 'user_suspended' })
  const oldReply = workspaceFixtures('starting').detail
  fixture.allowStart()
  // The server took the title at event 1, then the Resume at event 2, so
  // its reply holds the title. The owner change has no number, and it comes
  // after the reply was made.
  server.json('POST', resumePath, {
    ...oldReply,
    workspace: { ...oldReply.workspace, name: 'Newer workspace title' },
    eventNumber: 2,
  })
  held.holdAnswer('POST', resumePath)
  const resuming = workspace.resume()
  expect(workspace.startError.get()).toMatchObject({ code: 'user_suspended' })
  events.send({
    type: 'event',
    envelope: {
      workspaceId,
      eventNumber: 1,
      occurredAt: FAKE_TIME,
      event: { type: 'workspace.title', name: 'Newer workspace title' },
    },
  })
  workspace.reassigned({ ...oldReply.workspace, owner: nextOwner })
  expect(workspace.detail.get()).toMatchObject({
    state: 'ready',
    value: {
      workspace: {
        state: 'stopped',
        name: 'Newer workspace title',
        owner: nextOwner,
      },
      start: null,
      error: null,
    },
  })
  expect(workspace.startError.get()).toBe(null)
  held.release('POST', resumePath)
  await resuming
  expect(workspace.detail.get()).toMatchObject({
    state: 'ready',
    value: {
      workspace: {
        state: 'starting',
        name: 'Newer workspace title',
        owner: nextOwner,
      },
    },
  })
  workspace.close()
})

test('keeps an errored workspace open after a general start failure and permits retry', async () => {
  const fixture = setup(
    'error',
    new ApiError(
      503,
      'workspace_start_failed',
      'The cloud computer did not start.',
    ),
  )
  const { server, workspace } = fixture
  await workspace.open()
  expect(workspace.detail.get()).toMatchObject({
    state: 'ready',
    value: { workspace: { state: 'error' } },
  })
  expect(workspace.startError.get()).toMatchObject({
    code: 'workspace_start_failed',
  })
  fixture.allowStart()
  server.json('POST', resumePath, {
    ...workspaceFixtures('starting').detail,
    eventNumber: 0,
  })
  await workspace.resume()
  expect(workspace.detail.get()).toMatchObject({
    state: 'ready',
    value: { workspace: { state: 'starting' } },
  })
  expect(workspace.startError.get()).toBe(null)
  workspace.close()
})
