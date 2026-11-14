import { describe, expect, test } from 'vitest'
import type { WorkspaceStart } from '../shared/generated/WorkspaceStart'
import { workspacePaths } from '../shared/workspaces'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import { OrgModel } from './org-model'
import { valueOf } from './store'
import { HeldRequests, RecordingEvents, testServices } from './test-kit'
import { WorkspaceModel } from './workspace-model'

const orgId = FAKE_IDS.org
const workspaceId = FAKE_IDS.workspace
const resumePath = workspacePaths.resume(orgId, workspaceId)
const { workspace: shown, start, error } = workspaceFixtures('starting').detail
const recorded = { workspace: shown, start, error }
const starting = {
  ...recorded,
  workspace: {
    ...recorded.workspace,
    owner: {
      id: 'cal',
      githubLogin: 'calummoore',
      displayName: 'Cal',
      avatarUrl: null,
    },
  },
}
/** The Resume reply holds the state before the events that the tests send. */
const startingReply = { ...starting, eventNumber: 0 }
const completed: WorkspaceStart = {
  kind: 'resume',
  startedAt: FAKE_TIME - 3_000,
  steps: [
    {
      id: 'restore',
      label: 'Resuming with your files as you left them',
      state: 'completed',
      startedAt: FAKE_TIME - 3_000,
      completedAt: FAKE_TIME,
    },
  ],
}

async function openWorkspace() {
  const server = new FakeApiServer({ workspaceState: 'stopped' })
  const held = new HeldRequests(server)
  const events = new RecordingEvents()
  const org = new OrgModel(
    testServices(server, { fetch: held.fetch, events }),
    orgId,
  )
  const workspace = new WorkspaceModel(org, workspaceId)
  await org.reload('list')
  await workspace.open()
  server.json('POST', resumePath, startingReply)
  held.holdAnswer('POST', resumePath)
  return { held, events, org, workspace, server }
}

describe('WorkspaceModel Resume', () => {
  test('a starting reply keeps the ready workspace and completed start events that arrived during Resume', async () => {
    const { held, events, org, workspace } = await openWorkspace()
    const resuming = workspace.resume()
    const readyWorkspace = {
      ...starting.workspace,
      state: 'ready',
      updatedAt: FAKE_TIME,
    }
    events.send({
      type: 'event',
      envelope: {
        workspaceId,
        eventNumber: 1,
        occurredAt: FAKE_TIME,
        event: { type: 'start.updated', start: completed },
      },
    })
    events.send({
      type: 'event',
      envelope: {
        workspaceId,
        eventNumber: 2,
        occurredAt: FAKE_TIME,
        event: { type: 'workspace.updated', workspace: readyWorkspace },
      },
    })
    held.release('POST', resumePath)
    await resuming
    expect(valueOf(workspace.detail.get())).toEqual({
      workspace: readyWorkspace,
      start: completed,
      error: null,
    })
    expect(org.workspace(workspaceId)).toEqual(readyWorkspace)
    workspace.close()
  })

  test('a newer Resume reply shows, with the name of an older title event', async () => {
    const { held, events, org, workspace, server } = await openWorkspace()
    // The server renamed the workspace at event 1, then resumed it at 2.
    server.json('POST', resumePath, {
      ...starting,
      workspace: { ...starting.workspace, name: 'Address autocomplete' },
      eventNumber: 2,
    })
    const resuming = workspace.resume()
    events.send({
      type: 'event',
      envelope: {
        workspaceId,
        eventNumber: 1,
        occurredAt: FAKE_TIME,
        event: { type: 'workspace.title', name: 'Address autocomplete' },
      },
    })
    held.release('POST', resumePath)
    await resuming
    const expected = {
      ...starting.workspace,
      name: 'Address autocomplete',
    }
    expect(valueOf(workspace.detail.get())).toEqual({
      ...starting,
      workspace: expected,
    })
    expect(org.workspace(workspaceId)).toEqual(expected)
    workspace.close()
  })

  test('a Resume reply after close changes neither the detail nor the workspace list', async () => {
    const { held, org, workspace } = await openWorkspace()
    const before = workspace.detail.get()
    const listed = org.workspace(workspaceId)
    const resuming = workspace.resume()
    workspace.close()
    held.release('POST', resumePath)
    await resuming
    expect(workspace.detail.get()).toEqual(before)
    expect(org.workspace(workspaceId)).toEqual(listed)
  })

  test('an owner reply stays newer than a late refusal for the previous owner', async () => {
    const { held, org, workspace, server } = await openWorkspace()
    server.json(
      'POST',
      resumePath,
      { error: { code: 'user_suspended', message: 'The owner is suspended.' } },
      403,
    )
    const resuming = expect(workspace.resume()).rejects.toMatchObject({
      code: 'user_suspended',
    })
    const owner = { ...starting.workspace.owner, id: 'new-owner' }
    workspace.reassigned({ ...starting.workspace, owner })
    held.release('POST', resumePath)
    await resuming
    expect(valueOf(workspace.detail.get())?.workspace.owner).toEqual(owner)
    expect(org.workspace(workspaceId)?.owner).toEqual(owner)
    expect(workspace.startError.get()).toBe(null)
    workspace.close()
  })

  test('a start refusal after close changes neither the detail nor the start error', async () => {
    const { held, org, workspace, server } = await openWorkspace()
    server.json(
      'POST',
      resumePath,
      { error: { code: 'user_suspended', message: 'The owner is suspended.' } },
      403,
    )
    const before = workspace.detail.get()
    const listed = org.workspace(workspaceId)
    const resuming = expect(workspace.resume()).rejects.toMatchObject({
      code: 'user_suspended',
    })
    workspace.close()
    held.release('POST', resumePath)
    await resuming
    expect(workspace.detail.get()).toEqual(before)
    expect(org.workspace(workspaceId)).toEqual(listed)
    expect(workspace.startError.get()).toBe(null)
  })
})
