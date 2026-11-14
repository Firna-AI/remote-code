import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { routes } from '../../app/router'
import { selectText } from '../../chat/components/chip-field/attached-field-events'
import type { OrgRole } from '../../shared/api'
import { orgSettingsPaths } from '../../shared/org-settings'
import { workspacesPath } from '../../shared/workspaces'
import {
  accessibleName,
  byLabel,
  byRole,
  queryByLabel,
  queryByRole,
  queryByText,
} from '../../test-support/dom-queries'
import { pickFiles } from '../../test-support/file-picker'
import { repositoryFixtures } from '../../test-support/fixtures/repositories'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { messageText, pasteMessage } from '../../test-support/message-field'
import { MOUNTED_TEST_TIMEOUT } from '../../test-support/mount'
import { orgSuspendedBody } from '../../test-support/suspended-org'
import { click, press, settle, typeText } from '../test-mount'
import { here, isOff, org } from '../workspace/kept-test-kit'
import { orgRefusal } from '../workspace/SandboxNotice'
import {
  dialogIn,
  focusIn,
  mainOf,
  markOf,
  messageIn,
  newWorkspaceRow,
  openDialog,
  openTab,
  placeOf,
  serverWith,
  sidebarOf,
} from './dialog-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const task = 'Let shoppers save their cart.'
const linked = workspaceFixtures().workspaces.workspaces[0] as Workspace
const chipName = `W-${linked.number} ${linked.name}, Starting`

/** The names of the chips in a message field. */
const chipsIn = (field: HTMLElement) =>
  Array.from(field.querySelectorAll('[contenteditable="false"]'), (chip) =>
    accessibleName(chip),
  )
const chooseFirst = 'Choose the repositories of Acme first'
const adminChooses = 'An admin of Acme chooses its repositories first'

/** The fake API of an org that has chosen no repositories yet. */
function withoutRepositories(role: OrgRole) {
  const server = serverWith('dialog', { role })
  const { repositories } = repositoryFixtures(org).repositories
  server.json('GET', orgSettingsPaths.repositories(org), {
    repositories: repositories.map((item) => ({ ...item, selected: false })),
  })
  return server
}

/** Opens the dialog from the row at the top of the sidebar. */
const openFromRow = (view: HTMLElement) =>
  click(newWorkspaceRow(sidebarOf(view)))

describe('the New workspace dialog', () => {
  test('takes the focus to its message, and Escape or a press outside closes it, keeps the draft with its files for a reopen, also from the menu of General, and gives the focus back to the row', async () => {
    const tab = await openTab(serverWith('dialog'))
    const row = newWorkspaceRow(sidebarOf(tab.view))
    click(row)
    await settle()
    const message = messageIn(openDialog(tab.view))
    const focused = document.activeElement === message
    typeText(message, task)
    pasteMessage(message, ` Like ${linked.link}.`)
    const draft = tab.app.org(org).newWorkspace(null)
    const file = new File(['png'], 'postcode-overlap.png', {
      type: 'image/png',
    })
    // The pick goes to the caret that the field kept while the attach button
    // had the focus: after the first sentence.
    selectText(message, task, task.length, task.length)
    await pickFiles(openDialog(tab.view), [file])
    await settle()
    press(message, 'Escape')
    await settle()
    const escaped = {
      dialog: dialogIn(tab.view),
      rowFocused: document.activeElement === row,
    }
    click(row)
    await settle()
    const reopened = openDialog(tab.view)
    const kept = {
      text: messageText(messageIn(reopened)),
      chips: chipsIn(messageIn(reopened)),
      file: queryByLabel(`Remove ${file.name}`, reopened) !== null,
    }
    const outside = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(outside)
    })
    await settle()
    const pressedOutside = {
      dialog: dialogIn(tab.view),
      // A browser moves the focus at a press that the app does not keep.
      pressKept: outside.defaultPrevented,
      rowFocused: document.activeElement === row,
    }
    // The menu of General, the default section, opens the same draft.
    click(byLabel('More for General', sidebarOf(tab.view)))
    click(byRole('menuitem', 'New workspace', sidebarOf(tab.view)))
    await settle()
    const fromMenu = openDialog(tab.view)
    const withFile = `${task} ${markOf(draft, file.name)} Like ${linked.link}.`
    expect({
      focused,
      escaped,
      kept,
      pressedOutside,
      generalMenu: {
        place: placeOf(fromMenu),
        text: messageText(messageIn(fromMenu)),
      },
      address: tab.address(),
    }).toEqual({
      focused: true,
      escaped: { dialog: null, rowFocused: true },
      kept: {
        text: withFile,
        chips: ['Attached file postcode-overlap.png284 KB', chipName],
        file: true,
      },
      pressedOutside: { dialog: null, pressKept: true, rowFocused: true },
      generalMenu: { place: 'Acme · General', text: withFile },
      address: here,
    })
  })

  test('Escape in a menu of the dialog closes only the menu, and the next Escape closes the dialog', async () => {
    const tab = await openTab(serverWith('dialog'))
    openFromRow(tab.view)
    await settle()
    const dialog = openDialog(tab.view)
    click(byRole('button', 'Model and effort: Opus 5.5, High', dialog))
    const menu = () => queryByRole('menu', 'Model and effort', dialog)
    const opened = menu() !== null
    press(byRole('menuitemradio', 'Opus 5.5', dialog), 'Escape')
    await settle()
    const first = { menu: menu(), dialog: dialogIn(tab.view) !== null }
    press(document.activeElement ?? document.body, 'Escape')
    await settle()
    expect({ opened, first, second: dialogIn(tab.view) }).toEqual({
      opened: true,
      first: { menu: null, dialog: true },
      second: null,
    })
  })

  test('Connect closes the dialog first and opens the account with the Connect form of the agent, whose main area takes the focus, and the draft stays for the next dialog', async () => {
    const server = serverWith('dialog', {
      account: (account) => ({
        ...account,
        agentLogins: account.agentLogins.map((login) =>
          login.agent === 'claude'
            ? { agent: 'claude', connected: false }
            : login,
        ),
      }),
    })
    const tab = await openTab(server)
    openFromRow(tab.view)
    await settle()
    typeText(messageIn(openDialog(tab.view)), task)
    const create = byRole('button', 'Create', openDialog(tab.view))
    const createOff = isOff(create)
    click(byRole('button', 'Connect Claude', openDialog(tab.view)))
    await settle()
    const connect = {
      dialog: dialogIn(tab.view),
      address: tab.address(),
      page: tab.view.querySelector('main h1')?.textContent,
      focusInMain: focusIn(mainOf(tab.view)),
    }
    await tab.go(here)
    openFromRow(tab.view)
    await settle()
    expect({
      createOff,
      connect,
      kept: messageText(messageIn(openDialog(tab.view))),
    }).toEqual({
      createOff: true,
      connect: {
        dialog: null,
        address: routes.account('claude'),
        page: 'Account',
        focusInMain: true,
      },
      kept: task,
    })
  })

  test('in an org that the API finds suspended, the refused bar takes the place of the composer', async () => {
    const server = serverWith('dialog')
    server.json('POST', workspacesPath(org), orgSuspendedBody, 403)
    const tab = await openTab(server)
    openFromRow(tab.view)
    await settle()
    typeText(messageIn(openDialog(tab.view)), task)
    click(byRole('button', 'Create', openDialog(tab.view)))
    await settle()
    const dialog = openDialog(tab.view)
    expect({
      refused: queryByText(orgRefusal.reason, dialog) !== null,
      message: queryByLabel('Message', dialog),
      create: queryByRole('button', 'Create', dialog),
    }).toEqual({ refused: true, message: null, create: null })
  })

  test('in an org without chosen repositories, a member reads that an admin chooses them, with no repository and Create off', async () => {
    const tab = await openTab(withoutRepositories('member'))
    openFromRow(tab.view)
    await settle()
    const dialog = openDialog(tab.view)
    typeText(messageIn(dialog), task)
    expect({
      notice: queryByText(adminChooses, dialog) !== null,
      choose: queryByRole('button', 'Choose repositories', dialog),
      picker: dialog.querySelector('[aria-label^="Repository:"]'),
      createOff: isOff(byRole('button', 'Create', dialog)),
    }).toEqual({ notice: true, choose: null, picker: null, createOff: true })
  })

  test('in an org without chosen repositories, an admin reads that they choose them first, and Choose repositories closes the dialog and opens the Repositories tab, whose main area takes the focus', async () => {
    const tab = await openTab(withoutRepositories('admin'))
    openFromRow(tab.view)
    await settle()
    const dialog = openDialog(tab.view)
    const notice = queryByText(chooseFirst, dialog) !== null
    click(byRole('button', 'Choose repositories', dialog))
    await settle()
    expect({
      notice,
      dialog: dialogIn(tab.view),
      address: tab.address(),
      focusInMain: focusIn(mainOf(tab.view)),
    }).toEqual({
      notice: true,
      dialog: null,
      address: routes.settings(org, 'repositories'),
      focusInMain: true,
    })
  })
})
