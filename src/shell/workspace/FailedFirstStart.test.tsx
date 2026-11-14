// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import { routes } from '../../app/router'
import { requestLines } from '../../app/test-kit'
import type { WorkspaceEvent } from '../../shared/events'
import { sessionPaths } from '../../shared/sessions'
import {
  workspacePath,
  workspacePaths,
  workspacesPath,
} from '../../shared/workspaces'
import {
  byLabel,
  byRole,
  queryByLabel,
  queryByRole,
} from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { fakeGitHub } from '../../test-support/fake-tool-routes'
import { FAKE_TIME, fakeUsers } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import {
  holdAnimationFrames,
  MOUNTED_TEST_TIMEOUT,
} from '../../test-support/mount'
import { click, settle, typeText } from '../test-mount'
import { startedApp } from '../test-render'
import {
  away,
  bodiesOf,
  emit,
  headerName,
  isOff,
  lastEvent,
  messageField,
  mountTab,
  org,
  recordingSocket,
} from './kept-test-kit'
import { nameLabel } from '../../shared/name-label'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { created, detail, message, workspaces } = workspaceFixtures()
const createdId = created.workspace.id
/** The message that the workspace keeps in its queue. */
const queuedText = message.text
const saved =
  'The cloud computer did not start within the 20-minute limit. Try again.'
const resumeLine = `POST ${workspacePaths.resume(org, createdId)}`

/** An event of the created workspace, with its own event number. */
function createdEvent(event: WorkspaceEvent, server: FakeApiServer) {
  const envelope = {
    workspaceId: createdId,
    eventNumber: lastEvent(server) + 1,
    occurredAt: FAKE_TIME,
    event,
  }
  act(() => server.events.emit(envelope))
}

/** The start of the create, with each running step in `state`. */
function createStart(state: 'failed' | 'completed'): WorkspaceStart {
  const start = created.start
  if (!start) throw new Error('The created workspace has no start.')
  const steps = start.steps.map((step) =>
    step.state === 'running'
      ? { ...step, state, completedAt: FAKE_TIME }
      : step,
  )
  return { ...start, steps }
}

/** The Worker publishes the error state with its saved cause, then the failed step. */
function failFirstStart(server: FakeApiServer) {
  createdEvent(
    {
      type: 'workspace.updated',
      workspace: { ...created.workspace, state: 'error' },
      error: { code: 'workspace_start_failed', message: saved },
    },
    server,
  )
  createdEvent({ type: 'start.updated', start: createStart('failed') }, server)
}

const sidebar = (view: HTMLElement) =>
  view.querySelector('aside[aria-label="Workspaces"]')?.textContent ?? ''

const sentTexts = async (server: FakeApiServer) =>
  (
    await bodiesOf(
      server,
      'POST',
      sessionPaths.messages(org, createdId, created.sessionId),
      0,
    )
  ).map((body) => (body as { text: string }).text)

describe('a new workspace whose first start fails', () => {
  test('stays at its address and in the list, with its saved cause, its queue, an enabled composer, and Try again in the same workspace', async () => {
    holdAnimationFrames()
    const server = new FakeApiServer({ conversation: 'queued' })
    fakeGitHub(server, createdId, 'no-commits')
    const app = await startedApp(server, {
      events: recordingSocket(server).source,
    })
    const { view, go } = mountTab(app)
    await settle()
    go(routes.newWorkspace(org))
    await settle()
    typeText(messageField(view), 'Let shoppers save their cart.')
    click(byLabel('Send', view))
    await settle()
    expect(headerName(view)).toBe(nameLabel(created.workspace.name))

    failFirstStart(server)
    await settle()

    expect(headerName(view)).toBe(nameLabel(created.workspace.name))
    expect(sidebar(view)).toContain(nameLabel(created.workspace.name))
    expect(view.textContent).toContain("The sandbox couldn't start")
    expect(view.textContent).toContain(`${saved} Your chat is saved.`)
    expect(view.textContent).toContain(queuedText)
    expect(view.textContent).not.toContain("The workspace wasn't created")
    expect(queryByLabel('Message', view)).not.toBeNull()
    typeText(messageField(view), 'Keep a saved cart for 30 days.')
    expect(isOff(byLabel('Send', view))).toBe(false)
    click(byLabel('Send', view))
    await settle()
    expect(await sentTexts(server)).toEqual(['Keep a saved cart for 30 days.'])

    go(away)
    await settle()
    expect(sidebar(view)).toContain(nameLabel(created.workspace.name))
    go(routes.workspace(org, createdId))
    await settle()
    expect(headerName(view)).toBe(nameLabel(created.workspace.name))
    expect(view.textContent).toContain(`${saved} Your chat is saved.`)
    expect(queryByLabel('Message', view)).not.toBeNull()
    expect(requestLines(server)).not.toContain(resumeLine)

    const before = server.requests.length
    click(byRole('button', 'Try again', view))
    await settle()
    const after = requestLines(server).slice(before)
    expect(after).toContain(resumeLine)
    expect(after).not.toContain(`POST ${workspacesPath(org)}`)
  })

  test('shows the same workspace to another member after a reload, with its saved cause, its queue, the composer, and Try again', async () => {
    holdAnimationFrames()
    const server = new FakeApiServer({ conversation: 'queued' })
    const failed = { ...created.workspace, state: 'error' } as const
    fakeGitHub(server, createdId, 'no-commits')
    server.signIn(fakeUsers[1])
    server.json('GET', workspacesPath(org), {
      workspaces: [failed, ...workspaces.workspaces],
    })
    server.json('GET', workspacePath(org, createdId), {
      workspace: failed,
      start: createStart('failed'),
      error: { code: 'workspace_start_failed', message: saved, log: null },
      eventNumber: 0,
    })
    const app = await startedApp(server, {
      events: recordingSocket(server).source,
    })
    const { view, go } = mountTab(app)
    await settle()
    go(routes.workspace(org, createdId))
    await settle()

    expect(headerName(view)).toBe(nameLabel(created.workspace.name))
    expect(sidebar(view)).toContain(nameLabel(created.workspace.name))
    expect(view.textContent).toContain(`${saved} Your chat is saved.`)
    expect(view.textContent).toContain(queuedText)
    expect(queryByRole('button', 'Try again', view)).not.toBeNull()
    expect(requestLines(server)).not.toContain(resumeLine)
    typeText(messageField(view), 'Show a notice when a cart comes back.')
    expect(isOff(byLabel('Send', view))).toBe(false)
  })

  test('leaves a later error after a successful create and a failed resume with the bar in place of the composer', async () => {
    holdAnimationFrames()
    const server = new FakeApiServer()
    const app = await startedApp(server, {
      events: recordingSocket(server).source,
    })
    const { view } = mountTab(app)
    await settle()
    const broken: WorkspaceEvent = {
      type: 'workspace.updated',
      workspace: { ...detail.workspace, state: 'error' },
    }
    // A create that started keeps its start record. A later error of its
    // sandbox shows no failed step.
    const started = createStart('completed')
    emit(server, { type: 'start.updated', start: started })
    emit(server, broken)
    await settle()
    expect(queryByRole('button', 'Try again', view)).not.toBeNull()
    expect(queryByLabel('Message', view)).toBeNull()
    expect(view.textContent).toContain('Your files and chat are saved.')

    const resume: WorkspaceStart = {
      kind: 'resume',
      startedAt: FAKE_TIME,
      steps: [{ ...started.steps[0], state: 'failed' }],
    }
    emit(server, { type: 'start.updated', start: resume })
    emit(server, broken)
    await settle()
    expect(queryByRole('button', 'Try again', view)).not.toBeNull()
    expect(queryByLabel('Message', view)).toBeNull()
    expect(view.textContent).toContain('Your files and chat are saved.')
  })
})
