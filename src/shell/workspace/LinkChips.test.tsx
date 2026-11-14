import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { UserMessage } from '../../shared/generated/UserMessage'
import chipStyles from '../../../docs/mockups/src/components/chat/WorkspaceChip.module.css'
import { memoryNavigation, NavigationContext } from '../../app/navigation'
import { routes } from '../../app/router'
import { ManualDelay, requestLines } from '../../app/test-kit'
import { workspacesPath } from '../../shared/workspaces'
import { accessibleName, byText } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME, fakeUser } from '../../test-support/fixtures/core'
import {
  senderSnapshot,
  workspaceFixtures,
} from '../../test-support/fixtures/workspaces'
import {
  holdAnimationFrames,
  MOUNTED_TEST_TIMEOUT,
} from '../../test-support/mount'
import { Shell } from '../Shell'
import { click, mountScreen, settle } from '../test-mount'
import { startedApp } from '../test-render'
import { emit, here, org, recordingSocket } from './kept-test-kit'
import { linksTo, linkTo } from './wiring-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const listed = workspaceFixtures().workspaces.workspaces
const others = listed.filter((item) => item.id !== FAKE_IDS.workspace)
/**
 * A workspace that the message links, whose checks run. The test renames
 * it, and its checks pass.
 */
const linked: Workspace = {
  ...(others[0] as Workspace),
  github: 'checks-running',
}
/** A workspace that the message links, which is archived after failed checks. */
const archived: Workspace = {
  ...(others[1] as Workspace),
  state: 'archived',
  github: 'checks-failed',
  archivedAt: FAKE_TIME,
}
/** A link of another origin, which stays text. */
const elsewhere = `https://elsewhere.example${routes.workspace(org, linked.id)}`

/** The names of the chips of the chat, which are links to their workspaces. */
const chipsOf = (view: HTMLElement, workspace: Workspace) =>
  linksTo(view, routes.workspace(org, workspace.id)).map(accessibleName)

/** The list of the org on the fake server, with the changed workspaces. */
function serveList(server: FakeApiServer, changed: readonly Workspace[]) {
  const workspaces = listed.map(
    (item) => changed.find((change) => change.id === item.id) ?? item,
  )
  server.json('GET', workspacesPath(org), { workspaces })
}

const message: UserMessage = {
  id: 'links',
  sessionId: FAKE_IDS.session,
  sender: senderSnapshot(fakeUser),
  text: `Compare ${linked.link} with ${archived.link} and ${elsewhere}.`,
  attachments: [],
  choice: { agent: 'claude', model: 'Opus 5.5', effort: 'high', fast: false },
  createdAt: FAKE_TIME,
  state: 'sent',
}

/** The chat of the workspace on a phone, where no list is on the screen. */
async function openPhoneChat() {
  holdAnimationFrames()
  const server = new FakeApiServer()
  serveList(server, [linked, archived])
  const timers = new ManualDelay()
  const app = await startedApp(server, {
    events: recordingSocket(server).source,
    delay: timers.delay,
  })
  const navigation = memoryNavigation(here)
  const view = mountScreen(
    app,
    <NavigationContext.Provider value={navigation}>
      <Shell />
    </NavigationContext.Provider>,
    { viewport: 'phone' },
  )
  await settle()
  emit(server, { type: 'message.accepted', message })
  await settle()
  const listReads = () =>
    requestLines(server).filter((line) => line === `GET ${workspacesPath(org)}`)
      .length
  return { server, timers, view, navigation, listReads }
}

describe('workspace chips in the chat of the app', () => {
  test('shows each linked workspace with its current name, GitHub state, and state, keeps other links as text, and opens a chip in the same window', async () => {
    const { view, navigation } = await openPhoneChat()
    const chip = linkTo(view, routes.workspace(org, linked.id))
    expect({
      linked: chipsOf(view, linked),
      archived: chipsOf(view, archived),
      text: chip.parentElement?.textContent?.endsWith(` and ${elsewhere}.`),
    }).toEqual({
      linked: [`W-${linked.number} ${linked.name}, Checks running, Starting`],
      // The mark of an archived workspace shows no colour, so its chip says
      // no GitHub state.
      archived: [`W-${archived.number} ${archived.name}, Archived`],
      text: true,
    })

    const newTab = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    })
    act(() => {
      chip.dispatchEvent(newTab)
    })
    expect({ kept: newTab.defaultPrevented, at: navigation.href() }).toEqual({
      kept: false,
      at: here,
    })
    click(chip)
    await settle()
    expect(navigation.href()).toBe(routes.workspace(org, linked.id))
  })

  test('follows a rename, then a change of the GitHub state alone, then unread output in a bold name, while the chat shows on a phone, and reads no list while it is hidden', async () => {
    const { server, timers, view, navigation, listReads } =
      await openPhoneChat()
    const name = 'Saved carts for guests'
    const renamed: Workspace = { ...linked, name }
    serveList(server, [archived, renamed])
    await timers.runAll()
    await settle()
    expect(chipsOf(view, linked)).toEqual([
      `W-${linked.number} ${renamed.name}, Checks running, Starting`,
    ])
    // Only the GitHub state changes: the name, the state, and the time stay.
    const readyToMerge: Workspace = { ...renamed, github: 'ready-to-merge' }
    serveList(server, [archived, readyToMerge])
    await timers.runAll()
    await settle()
    expect(chipsOf(view, linked)).toEqual([
      `W-${linked.number} ${renamed.name}, Ready to merge, Starting`,
    ])
    // Its cloud computer is ready, then its agent finishes a turn that the
    // reader has not read. With the same GitHub state, only the bold name
    // shows the unread output.
    const strongName = () =>
      byText(
        name,
        linkTo(view, routes.workspace(org, linked.id)),
      ).classList.contains(chipStyles.strong)
    serveList(server, [archived, { ...readyToMerge, state: 'ready' }])
    await timers.runAll()
    await settle()
    const ready = { words: chipsOf(view, linked), strong: strongName() }
    serveList(server, [archived, { ...readyToMerge, state: 'unread' }])
    await timers.runAll()
    await settle()
    expect({
      ready,
      unread: { words: chipsOf(view, linked), strong: strongName() },
    }).toEqual({
      ready: {
        words: [`W-${linked.number} ${renamed.name}, Ready to merge, Ready`],
        strong: false,
      },
      unread: {
        words: [
          `W-${linked.number} ${renamed.name}, Ready to merge, Done, unread`,
        ],
        strong: true,
      },
    })

    act(() => navigation.push(routes.accountTab('general')))
    await settle()
    const hidden = listReads()
    await timers.runAll()
    await settle()
    expect(listReads()).toBe(hidden)
  })
})
