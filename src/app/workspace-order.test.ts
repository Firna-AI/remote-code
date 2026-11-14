import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import { describe, expect, test } from 'vitest'
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
  flushMicrotasks,
  HeldRequests,
  RecordingEvents,
  testServices,
} from './test-kit'
import { WorkspaceModel } from './workspace-model'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const resumePath = workspacePaths.resume(orgId, workspaceId)
const readPath = workspacePaths.read(orgId, workspaceId)
const starting = workspaceFixtures('starting').detail
const archived = workspaceFixtures('archived').detail.workspace

const output: WorkspaceEvent = {
  type: 'assistant.delta',
  sessionId: FAKE_IDS.session,
  turnId: 'turn-1',
  messageId: 'answer-1',
  text: 'The answer is ready.',
}

/** An open workspace on the fake API, whose Resume answer waits for the test. */
async function opened(initial: WorkspaceState) {
  const server = new FakeApiServer({ workspaceState: initial })
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  const org = new OrgModel(
    testServices(server, { fetch: held.fetch, events }),
    orgId,
  )
  const workspace = new WorkspaceModel(org, workspaceId)
  await org.reload('list')
  await workspace.open()
  held.holdAnswer('POST', resumePath)
  const live = (eventNumber: number, event: WorkspaceEvent) =>
    events.send({
      type: 'event',
      envelope: { workspaceId, eventNumber, occurredAt: FAKE_TIME, event },
    })
  const page = (events: readonly WorkspaceEvent[], through: number) => ({
    type: 'history',
    history: {
      events: events.map((event, index) => ({
        workspaceId,
        eventNumber: through - events.length + index + 1,
        occurredAt: FAKE_TIME,
        event,
      })),
      throughEventNumber: through,
    },
  })
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
  const state = () => valueOf(workspace.detail.get())?.workspace.state
  return { server, held, events, org, workspace, live, page, marks, state }
}

describe('the order of the open workspace', () => {
  test('an older event of the stream after a newer Resume reply changes nothing', async () => {
    const { server, held, org, workspace, live, state } =
      await opened('stopped')
    server.json('POST', resumePath, { ...starting, eventNumber: 3 })
    const resuming = workspace.resume()
    held.release('POST', resumePath)
    await resuming
    // The stream brings an event that the reply already holds.
    live(1, {
      type: 'workspace.updated',
      workspace: { ...starting.workspace, state: 'stopped' },
    })
    expect(state()).toBe('starting')
    expect(org.workspace(workspaceId)?.state).toBe('starting')
    workspace.close()
  })

  test('keeps an Archive that came while Resume waited over the newer reply of the Resume', async () => {
    const { server, held, org, workspace, live, state } =
      await opened('stopped')
    server.json('POST', resumePath, { ...starting, eventNumber: 1 })
    const resuming = workspace.resume()
    const newer = {
      ...starting.workspace,
      name: 'A newer workspace name',
      owner: {
        id: 'new-owner',
        githubLogin: 'calummoore',
        displayName: 'Cal',
        avatarUrl: null,
      },
      updatedAt: FAKE_TIME + 1_000,
    }
    live(1, { type: 'workspace.updated', workspace: newer })
    const listed = { ...newer, name: 'The latest listed name' }
    org.putWorkspace(listed)
    // The Worker saved the newer record, so its Archive is newer still. The
    // reply holds the name and the owner from before that record.
    const lifecycle = {
      state: 'archived',
      archivedAt: FAKE_TIME + 2_000,
      restoreUntil: FAKE_TIME + 2_000 + WORKSPACE_RESTORE_MS,
      updatedAt: FAKE_TIME + 2_000,
    } as const
    server.json('POST', workspacePaths.archive(orgId, workspaceId), {
      workspace: { ...starting.workspace, ...lifecycle },
      start: null,
      error: null,
    })
    await workspace.archive.archive()
    const shown = () => valueOf(workspace.detail.get())?.workspace
    expect(shown()).toEqual({ ...newer, ...lifecycle })
    expect(org.workspace(workspaceId)).toEqual({ ...listed, ...lifecycle })
    expect(state()).toBe('archived')
    held.release('POST', resumePath)
    await resuming
    expect(shown()).toEqual({ ...newer, ...lifecycle })
    expect(org.workspace(workspaceId)).toEqual({ ...listed, ...lifecycle })
    live(2, { type: 'workspace.updated', workspace: starting.workspace })
    expect(shown()).toEqual({ ...newer, ...lifecycle })
    expect(org.workspace(workspaceId)).toEqual({ ...listed, ...lifecycle })
    workspace.close()
  })

  test('shows a list Archive without an event and keeps it over a pending Resume', async () => {
    const { server, held, org, workspace, live, events, page } =
      await opened('error')
    const before = valueOf(workspace.detail.get())?.workspace
    if (!before) throw new Error('The workspace did not open.')
    server.json('POST', resumePath, { ...starting, eventNumber: 1 })
    const resuming = workspace.resume()
    await flushMicrotasks()
    org.putWorkspace(archived)
    // The list gives the fields of the Archive. The detail keeps its own
    // other fields, which its stream orders.
    const expected = {
      state: 'ready',
      value: {
        workspace: {
          ...before,
          state: 'archived',
          archivedAt: archived.archivedAt,
          restoreUntil: archived.restoreUntil,
          updatedAt: archived.updatedAt,
        },
        start: null,
        error: null,
      },
    }
    expect(workspace.detail.get()).toEqual(expected)
    held.release('POST', resumePath)
    await resuming
    expect(workspace.detail.get()).toEqual(expected)
    expect(org.workspace(workspaceId)?.state).toBe('archived')
    events.send(page([], 1))
    workspace.reassigned({
      ...archived,
      owner: { ...archived.owner, id: 'new-owner' },
    })
    const reassigned = workspace.detail.get()
    const listed = org.workspace(workspaceId)
    live(2, {
      type: 'workspace.updated',
      workspace: starting.workspace,
    })
    expect(workspace.detail.get()).toEqual(reassigned)
    expect(org.workspace(workspaceId)).toEqual(listed)
    if (!starting.start) throw new Error('The starting fixture has no steps.')
    live(3, { type: 'start.updated', start: starting.start })
    expect(workspace.detail.get()).toEqual(reassigned)
    expect(org.workspace(workspaceId)).toEqual(listed)
    live(4, { type: 'workspace.title', name: 'An older workspace title' })
    expect(workspace.detail.get()).toEqual(reassigned)
    expect(org.workspace(workspaceId)).toEqual(listed)
    workspace.close()
  })

  test('shows a list Archive before an older open answers and never resumes it', async () => {
    const server = new FakeApiServer({ workspaceState: 'stopped' })
    const held = new HeldRequests(server)
    const org = new OrgModel(testServices(server, { fetch: held.fetch }), orgId)
    await org.reload('list')
    const workspace = new WorkspaceModel(org, workspaceId)
    const path = workspacePath(orgId, workspaceId)
    held.holdAnswer('GET', path)
    const opening = workspace.open()
    await flushMicrotasks()
    org.putWorkspace(archived)
    const expected = {
      state: 'ready',
      value: { workspace: archived, start: null, error: null },
    }
    expect(workspace.detail.get()).toEqual(expected)
    held.release('GET', path)
    await opening
    expect(workspace.detail.get()).toEqual(expected)
    expect(org.workspace(workspaceId)?.state).toBe('archived')
    expect(
      server.requests.filter(
        (request) =>
          request.method === 'POST' &&
          new URL(request.url).pathname === resumePath,
      ),
    ).toHaveLength(0)
    server.json(
      'GET',
      path,
      {
        error: { code: 'network_failure', message: 'The detail did not load.' },
      },
      503,
    )
    await workspace.open()
    expect(workspace.detail.get()).toEqual(expected)
    workspace.close()
  })

  test('keeps a read mark that came while Resume waited over the reply of the Resume', async () => {
    const { server, held, org, workspace, live, state } = await opened('unread')
    const unread = valueOf(workspace.detail.get())
    if (!unread) throw new Error('The workspace did not open.')
    // The reply holds the state when the Resume began: still unread.
    server.json('POST', resumePath, { ...unread, eventNumber: 0 })
    const resuming = workspace.resume()
    live(1, output)
    await flushMicrotasks()
    expect(state()).toBe('ready')
    const shown: (string | undefined)[] = []
    workspace.detail.subscribe(() => shown.push(state()))
    held.release('POST', resumePath)
    await resuming
    // The reply shows once, as ready, with no unread state in between.
    expect(shown).toEqual(['ready'])
    expect(org.workspace(workspaceId)?.state).toBe('ready')
    workspace.close()
  })

  test('keeps a newer unread read after a reopen until the replay and a mark reach it', async () => {
    const { server, events, workspace, page, marks, state } =
      await opened('unread')
    events.send(page([output], 1))
    await flushMicrotasks()
    expect(state()).toBe('ready')
    workspace.close()
    // New output came while the tab showed another page.
    server.json('GET', workspacePath(orgId, workspaceId), {
      ...workspaceFixtures('unread').detail,
      eventNumber: 2,
    })
    await workspace.open()
    await flushMicrotasks()
    expect(state()).toBe('unread')
    expect(await marks()).toEqual([{ throughEventNumber: 1 }])
    events.send(page([output], 2))
    await flushMicrotasks()
    expect(await marks()).toEqual([
      { throughEventNumber: 1 },
      { throughEventNumber: 2 },
    ])
    expect(state()).toBe('ready')
    workspace.close()
  })
})
