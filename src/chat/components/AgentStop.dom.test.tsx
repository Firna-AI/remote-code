import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { routes } from '../../app/router'
import type { WorkspaceEvent } from '../../shared/events'
import { sessionLink } from '../../shared/session-link'
import { sessionsPath } from '../../shared/sessions'

import { FAKE_IDS, FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { holdAnimationFrames, mount, waitFor } from '../../test-support/mount'
import { chatFor } from '../state/test-kit'
import { WorkspaceChatView } from '../WorkspaceChat'

const { org, workspace: own, session } = FAKE_IDS
const fixtures = workspaceFixtures()

/** A workspace of the list of the org, which the chips of the chat find. */
function listed(workspaceId: string): Workspace {
  const found = fixtures.workspaces.workspaces.find(
    (item) => item.id === workspaceId,
  )
  if (!found) throw new Error(`The fake list has no workspace ${workspaceId}.`)
  return found
}

/** Another workspace of the org, whose session titles only its read gives. */
const other = listed('fix-cart-flake')

/** The sessions of the other workspace, as its one read gives them. */
const otherSessions = {
  eventNumber: 0,
  sessions: [
    {
      ...fixtures.sessions.sessions[0],
      id: 'plan',
      workspaceId: other.id,
      title: 'Plan saved carts',
    },
  ],
  history: [],
}

/**
 * A turn of the shown session that the agent of the `source` session stopped
 * with a workspace tool. The end leaves out `omittedFileCount` changed files.
 */
function stopFrom(
  turnId: string,
  source: { workspaceId: string; sessionId: string },
  omittedFileCount = 0,
): WorkspaceEvent[] {
  const turn = { sessionId: session, turnId }
  return [
    { ...turn, type: 'turn.thinking' },
    { ...turn, type: 'turn.stop-requested', requestedBySession: source },
    {
      ...turn,
      type: 'turn.completed',
      state: 'stopped',
      durationMs: 1_000,
      files: [],
      omittedFileCount,
      userMessageIds: [],
    },
  ]
}

/**
 * Each stop line of the chat, found by its stop icon: its text, as a screen
 * reader hears it, and the page that each chip in it opens.
 */
function stopLines(root: HTMLElement) {
  return Array.from(root.querySelectorAll('.lucide-circle-stop'), (icon) => {
    const line = icon.parentElement
    return {
      text: line?.textContent ?? '',
      opens: Array.from(line?.querySelectorAll('a') ?? [], (chip) =>
        chip.getAttribute('href'),
      ),
    }
  })
}

describe('the line of a stop by an agent', () => {
  it('names the stopping session with its chip, reads the sessions of another workspace once, and keeps the link of an unknown workspace as text', async () => {
    holdAnimationFrames()
    const otherRead = sessionsPath(org, other.id)
    const chat = chatFor({
      conversation: 'running',
      hold: (request) => new URL(request.url).pathname === otherRead,
    })
    chat.server.json('GET', otherRead, otherSessions)
    await chat.controller.start()
    const { container } = await mount(
      <WorkspaceChatView controller={chat.controller} viewport="desktop" />,
    )
    await waitFor(
      () => chat.controller.workspaceList.workspaces.get(),
      'the workspace list that the chips find',
    )

    const stops = [
      ...stopFrom('turn-1', { workspaceId: own, sessionId: 'debounce' }, 5),
      ...stopFrom('turn-2', { workspaceId: other.id, sessionId: 'plan' }),
      ...stopFrom('turn-3', { workspaceId: other.id, sessionId: 'missing' }),
      ...stopFrom('turn-4', { workspaceId: 'gone', sessionId: 'old' }),
    ]
    act(() => {
      for (const event of stops) chat.emit(event)
    })
    await waitFor(
      () => stopLines(container).length === 4,
      'the lines of the four stopped turns',
    )
    const ownChip = `W-${listed(own).number} Session Debounce the address lookups to 250 ms, Ready to merge, Ready`
    const otherChip = `W-${other.number} ${other.name}, Checks running, Working`
    const unknown = sessionLink(FAKE_ORIGIN, org, 'gone', 'old')
    // The read of the other workspace waits, so its sessions keep the chip
    // of their workspace, and the two stops ask for the one read.
    expect({ lines: stopLines(container), reads: chat.held.length }).toEqual({
      lines: [
        {
          text: `Stopped from ${ownChip} · 5 changed files not listed`,
          opens: [routes.session(org, own, 'debounce')],
        },
        {
          text: `Stopped from ${otherChip}`,
          opens: [routes.session(org, other.id, 'plan')],
        },
        {
          text: `Stopped from ${otherChip}`,
          opens: [routes.session(org, other.id, 'missing')],
        },
        { text: `Stopped from ${unknown}`, opens: [] },
      ],
      reads: 1,
    })

    act(() => {
      for (const release of chat.held.splice(0)) release()
    })
    await waitFor(
      () =>
        chat.controller.sessionReads.getSnapshot()[other.id]?.state === 'ready',
      'the read of the other workspace',
    )
    expect({
      lines: stopLines(container).map((line) => line.text),
      reads: chat.requests('GET', otherRead).length,
    }).toEqual({
      lines: [
        `Stopped from ${ownChip} · 5 changed files not listed`,
        `Stopped from W-${other.number} Session Plan saved carts, Checks running, Working`,
        `Stopped from ${otherChip}`,
        `Stopped from ${unknown}`,
      ],
      reads: 1,
    })
  })
})
