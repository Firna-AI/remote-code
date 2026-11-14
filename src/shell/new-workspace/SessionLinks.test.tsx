import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { describe, expect, test, vi } from 'vitest'
import { routes } from '../../app/router'
import { requestLines } from '../../app/test-kit'
import { sessionLink } from '../../shared/session-link'
import { sessionsPath } from '../../shared/sessions'

import { accessibleName } from '../../test-support/dom-queries'
import { FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { pasteMessage } from '../../test-support/message-field'
import { MOUNTED_TEST_TIMEOUT } from '../../test-support/mount'
import { settle } from '../test-mount'
import { org } from '../workspace/kept-test-kit'
import { mainOf, messageIn, openTab, serverWith } from './dialog-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { workspaces, sessions } = workspaceFixtures()
const linked = workspaces.workspaces[0] as Workspace
const link = (sessionId: string) =>
  sessionLink(FAKE_ORIGIN, org, linked.id, sessionId)

describe('session links in New workspace', () => {
  test('a pasted session link shows as a session chip, with one read of its workspace for the page', async () => {
    const server = serverWith('page')
    server.json('GET', sessionsPath(org, linked.id), {
      eventNumber: 0,
      sessions: [
        {
          ...sessions.sessions[0],
          id: 'plan',
          workspaceId: linked.id,
          title: 'Plan saved carts',
        },
      ],
      history: [],
    })
    const tab = await openTab(server, { at: routes.newWorkspace(org) })
    const field = messageIn(mainOf(tab.view))
    pasteMessage(field, `Follow ${link('plan')} and ${link('missing')}.`)
    await settle()
    const chips = Array.from(
      field.querySelectorAll('[contenteditable="false"]'),
      (chip) => accessibleName(chip),
    )
    const reads = requestLines(server).filter(
      (line) => line === `GET ${sessionsPath(org, linked.id)}`,
    )
    expect({ chips, reads: reads.length }).toEqual({
      chips: [
        `W-${linked.number} Session Plan saved carts, Starting`,
        `W-${linked.number} ${linked.name}, Starting`,
      ],
      reads: 1,
    })
  })
})
