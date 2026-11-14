import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { UserMessage } from '../../shared/generated/UserMessage'
import chipStyles from '../../../docs/mockups/src/components/chat/WorkspaceChip.module.css'
import { routes } from '../../app/router'
import { ManualDelay, requestLines } from '../../app/test-kit'
import { sessionLink } from '../../shared/session-link'
import { sessionsPath } from '../../shared/sessions'
import { workspacesPath } from '../../shared/workspaces'
import { accessibleName } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import {
  FAKE_IDS,
  FAKE_ORIGIN,
  FAKE_TIME,
  fakeUser,
} from '../../test-support/fixtures/core'
import {
  senderSnapshot,
  workspaceFixtures,
} from '../../test-support/fixtures/workspaces'
import { MOUNTED_TEST_TIMEOUT } from '../../test-support/mount'
import { settle } from '../test-mount'
import { emit, here, id, org } from './kept-test-kit'
import { linksTo, linkTo, openTab } from './wiring-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { workspaces, sessions } = workspaceFixtures()
const own = workspaces.workspaces.find((item) => item.id === id) as Workspace
const other = workspaces.workspaces.find((item) => item.id !== id) as Workspace
const [first, second] = sessions.sessions

/** The sessions of the other workspace, whose titles only its read gives. */
const otherSessions = {
  eventNumber: 0,
  sessions: [
    { ...first, id: 'plan', workspaceId: other.id, title: 'Plan saved carts' },
  ],
  history: [
    {
      ...sessions.history[0],
      id: 'notes',
      workspaceId: other.id,
      title: 'Read the cart notes',
    },
  ],
}

const link = (workspaceId: string, sessionId: string) =>
  sessionLink(FAKE_ORIGIN, org, workspaceId, sessionId)

const message: UserMessage = {
  id: 'session-links',
  sessionId: FAKE_IDS.session,
  sender: senderSnapshot(fakeUser),
  text: `Ask ${link(id, 'debounce')}, then ${link(other.id, 'plan')}, ${link(other.id, 'notes')}, and ${link(other.id, 'missing')}.`,
  attachments: [],
  choice: { agent: 'claude', model: 'Opus 5.5', effort: 'high', fast: false },
  createdAt: FAKE_TIME,
  state: 'sent',
}

/** The names of the chips that link to a session address. */
const chipsTo = (view: HTMLElement, workspaceId: string, sessionId: string) =>
  linksTo(view, routes.session(org, workspaceId, sessionId)).map(accessibleName)

describe('session chips in the chat of the app', () => {
  test('show the live title of a session of the chat, the read titles of another workspace, and the workspace chip for an unknown session', async () => {
    const server = new FakeApiServer()
    server.json('GET', sessionsPath(org, other.id), otherSessions)
    const timers = new ManualDelay()
    const { view } = await openTab(server, here, { delay: timers.delay })
    emit(server, { type: 'message.accepted', message })
    await settle()
    const renamed = { ...second, title: 'Debounce lookups by 300 ms' }
    emit(server, { type: 'session.updated', session: renamed })
    await settle()
    const reads = requestLines(server).filter(
      (line) => line === `GET ${sessionsPath(org, other.id)}`,
    )
    const label = `W-${other.number}`
    expect({
      own: chipsTo(view, id, 'debounce'),
      open: chipsTo(view, other.id, 'plan'),
      closed: chipsTo(view, other.id, 'notes'),
      unknown: chipsTo(view, other.id, 'missing'),
      reads: reads.length,
    }).toEqual({
      own: [
        `W-${own.number} Session Debounce lookups by 300 ms, Ready to merge, Ready`,
      ],
      open: [`${label} Session Plan saved carts, Starting`],
      closed: [`${label} Session Read the cart notes, Starting`],
      unknown: [`${label} ${other.name}, Starting`],
      reads: 1,
    })
    const emphasis = async (state: 'ready' | 'unread') => {
      server.json('GET', workspacesPath(org), {
        workspaces: workspaces.workspaces.map((workspace) =>
          workspace.id === other.id ? { ...workspace, state } : workspace,
        ),
      })
      await act(() => timers.runAll())
      await settle()
      const chip = linkTo(view, routes.session(org, other.id, 'plan'))
      const title = Array.from(chip.querySelectorAll('span')).find(
        (node) => node.textContent === 'Plan saved carts',
      )
      if (!title) throw new Error('Expected the linked session title.')
      return {
        strong: title.classList.contains(chipStyles.strong),
        text: title.parentElement?.classList.contains(chipStyles.text),
      }
    }
    expect({
      ready: await emphasis('ready'),
      unread: await emphasis('unread'),
    }).toEqual({
      ready: { strong: false, text: true },
      unread: { strong: true, text: true },
    })
  })
})
