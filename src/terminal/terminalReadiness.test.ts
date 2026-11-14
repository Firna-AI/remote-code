import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import { describe, expect, it } from 'vitest'
import type { WorkspaceEvent } from '../shared/events'
import { terminalPaths, type TerminalResponse } from '../shared/terminal'

import { workspaceFixtures } from '../test-support/fixtures/workspaces'
import type { ToolResult } from './tool-parts/request'
import {
  initialReadiness,
  readinessReducer,
  type TerminalReadinessAction,
} from './terminalReadiness'

const ready = {
  state: 'ready',
  socketPath: terminalPaths.socket('acme', 'checkout-autocomplete'),
  protocol: 'tty',
} as const

function answer(
  read: number,
  value: TerminalResponse,
): TerminalReadinessAction {
  const result: ToolResult<TerminalResponse> = { ok: true, value }
  return { type: 'answer', read, result }
}

/** The event that reports the workspace in a new state. */
function updated(state: WorkspaceState): WorkspaceEvent {
  const { workspace } = workspaceFixtures().detail
  return { type: 'workspace.updated', workspace: { ...workspace, state } }
}

function reduce(...actions: (TerminalReadinessAction | WorkspaceEvent)[]) {
  return actions.reduce(readinessReducer, initialReadiness)
}

describe('terminal readiness', () => {
  it('reads again when the sandbox runs during a read, and keeps the older answer from a wait', () => {
    const state = reduce(
      updated('input'),
      answer(1, { state: 'starting', socketPath: null }),
    )

    expect(state).toEqual({ view: { state: 'loading' }, read: 2 })
    expect(readinessReducer(state, answer(2, ready))).toEqual({
      view: { state: 'ready', terminal: ready, ended: false },
      read: 2,
    })
  })

  it('keeps a connected terminal when the workspace moves between running states', () => {
    const state = reduce(
      answer(1, ready),
      updated('working'),
      updated('input'),
      updated('unread'),
    )

    expect(state).toEqual({
      view: { state: 'ready', terminal: ready, ended: false },
      read: 1,
    })
  })
})
