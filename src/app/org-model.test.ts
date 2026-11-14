import type { GitHubSummary } from '../shared/generated/GitHubSummary'
import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import { describe, expect, test } from 'vitest'

import { orgSettingsPaths, type ImageBuild } from '../shared/org-settings'
import {
  routinesPath,
  type RoutineRun,
  type RoutinesResponse,
} from '../shared/routines'
import { workspacesPath } from '../shared/workspaces'
import { FakeApiServer } from '../test-support/fake-api'
import {
  coreFixtures,
  FAKE_IDS,
  FAKE_TIME,
} from '../test-support/fixtures/core'
import { routineFixtures } from '../test-support/fixtures/routines'
import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import { latestBuild, OrgModel } from './org-model'
import { valueOf } from './store'
import {
  flushMicrotasks,
  HeldRequests,
  ManualDelay,
  ManualFocus,
  requestLines,
  testServices,
} from './test-kit'

const org = FAKE_IDS.org
const fixtures = workspaceFixtures()
const refused = {
  error: { code: 'server_error', message: 'The request failed.' },
}

/** The list of the server, with new states and GitHub states for some workspaces. */
function serverList(
  states: Partial<Record<string, WorkspaceState>>,
  github: Partial<Record<string, GitHubSummary>> = {},
) {
  return {
    workspaces: fixtures.workspaces.workspaces.map((workspace) => ({
      ...workspace,
      state: states[workspace.id] ?? workspace.state,
      github: github[workspace.id] ?? workspace.github,
    })),
  }
}

/** The routines of the server, with a new state of the last run of one. */
function routinesWith(state: RoutineRun['state']): RoutinesResponse {
  return {
    routines: routineFixtures().list.routines.map((routine) =>
      routine.id === 'review-prs' && routine.lastRun
        ? { ...routine, lastRun: { ...routine.lastRun, state } }
        : routine,
    ),
  }
}

describe('OrgModel', () => {
  test('a shown list reads again at each entry, at focus, and on a timer that is faster while a row is active or its checks run', async () => {
    const server = new FakeApiServer()
    const delay = new ManualDelay()
    const focus = new ManualFocus()
    const model = new OrgModel(
      testServices(server, { delay: delay.delay, onFocus: focus.onFocus }),
      org,
    )
    const reads = () =>
      requestLines(server).filter(
        (line) => line === `GET ${workspacesPath(org)}`,
      ).length
    const state = (workspaceId: string) => model.workspace(workspaceId)?.state
    const leave = model.watch('list')
    await flushMicrotasks()
    leave()
    // While no list shows, the start of email-dark-mode ends on the server.
    server.json(
      'GET',
      workspacesPath(org),
      serverList({ 'email-dark-mode': 'ready' }),
    )
    const sidebar = model.watch('list')
    const page = model.watch('list')
    await flushMicrotasks()
    expect({ reads: reads(), state: state('email-dark-mode') }).toEqual({
      reads: 2,
      state: 'ready',
    })
    const active = delay.waits
    // fix-cart-flake still works. Its turn and the running checks of the
    // list end before the timer.
    const ended = {
      'email-dark-mode': 'ready',
      'fix-cart-flake': 'unread',
    } as const
    const passed = {
      'fix-cart-flake': 'ready-to-merge',
      'retry-queue': 'ready-to-merge',
    } as const
    server.json('GET', workspacesPath(org), serverList(ended, passed))
    await delay.runAll()
    const idle = delay.waits
    // The checks of retry-queue run again. Its cloud computer stays stopped,
    // and no agent works.
    server.json(
      'GET',
      workspacesPath(org),
      serverList(ended, { ...passed, 'retry-queue': 'checks-running' }),
    )
    await delay.runAll()
    const checking = delay.waits
    expect({
      reads: reads(),
      state: state('fix-cart-flake'),
      timers: [active.length, idle.length, checking.length],
      faster: Math.max(...active) < Math.min(...idle),
      checks: Math.max(...checking) < Math.min(...idle),
    }).toEqual({
      reads: 4,
      state: 'unread',
      timers: [1, 1, 1],
      faster: true,
      checks: true,
    })
    focus.focus()
    await flushMicrotasks()
    expect(reads()).toBe(5)
    sidebar()
    expect(delay.pending).toBe(1)
    page()
    expect({ timers: delay.pending, focus: focus.listening }).toEqual({
      timers: 0,
      focus: 0,
    })
  })

  test('a list answer that started before an update keeps the update, and a failed read keeps the list', async () => {
    const server = new FakeApiServer()
    const held = new HeldRequests(server)
    const model = new OrgModel(testServices(server, { fetch: held.fetch }), org)
    await model.reload('list')
    const working = model.workspace('fix-cart-flake')
    if (!working) throw new Error('The fixture has no fix-cart-flake.')
    held.hold('GET', workspacesPath(org))
    const reading = model.reload('list')
    // The event of the end of its turn comes while the read waits.
    model.putWorkspace({ ...working, state: 'unread' })
    held.release('GET', workspacesPath(org))
    await reading
    expect(model.workspace('fix-cart-flake')?.state).toBe('unread')
    server.json('GET', workspacesPath(org), refused, 500)
    await model.reload('list')
    expect({
      list: model.workspaces.get().state,
      state: model.workspace('fix-cart-flake')?.state,
    }).toEqual({ list: 'ready', state: 'unread' })
  })

  test('the builds of a shown sidebar read again while a build runs, so a failure shows with the computer tab closed', async () => {
    const server = new FakeApiServer()
    const delay = new ManualDelay()
    const done = coreFixtures().build.build
    const running: ImageBuild = {
      ...done,
      id: 'build-2',
      state: 'running',
      startedAt: FAKE_TIME,
      completedAt: null,
      durationMs: null,
    }
    const failed: ImageBuild = {
      ...running,
      state: 'failed',
      completedAt: FAKE_TIME + 60_000,
      durationMs: 60_000,
      error: 'The install script failed.',
    }
    const history = (latest: ImageBuild) => ({
      builds: [latest, done],
      currentImageBuildId: done.id,
      changes: {
        installScript: false,
        addedRepositories: [],
        removedRepositories: [],
      },
    })
    server.json('GET', orgSettingsPaths.builds(org), history(running))
    const model = new OrgModel(
      testServices(server, { delay: delay.delay }),
      org,
    )
    const release = model.watch('builds')
    await flushMicrotasks()
    server.json('GET', orgSettingsPaths.builds(org), history(failed))
    await delay.runAll()
    const builds = valueOf(model.builds.get())
    expect({
      latest: builds && latestBuild(builds)?.state,
      timers: delay.pending,
    }).toEqual({ latest: 'failed', timers: 1 })
    release()
  })

  test('shown routines read again on a timer that is faster while a last run is queued or works', async () => {
    const server = new FakeApiServer()
    const delay = new ManualDelay()
    const model = new OrgModel(
      testServices(server, { delay: delay.delay }),
      org,
    )
    server.json('GET', routinesPath(org), routinesWith('queued'))
    const release = model.watch('routines')
    await flushMicrotasks()
    const queued = delay.waits
    server.json('GET', routinesPath(org), routinesWith('ready'))
    await delay.runAll()
    const idle = delay.waits
    server.json('GET', routinesPath(org), routinesWith('working'))
    await delay.runAll()
    const working = delay.waits
    release()
    expect({
      reads: requestLines(server).filter(
        (line) => line === `GET ${routinesPath(org)}`,
      ).length,
      lastRun: valueOf(model.routines.get())?.find(
        (routine) => routine.id === 'review-prs',
      )?.lastRun?.state,
      timers: [queued.length, idle.length, working.length],
      faster: Math.max(...queued, ...working) < Math.min(...idle),
      pending: delay.pending,
    }).toEqual({
      reads: 3,
      lastRun: 'working',
      timers: [1, 1, 1],
      faster: true,
      pending: 0,
    })
  })
})
