import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { routes } from '../../app/router'
import { rightClick } from '../../chat/components/tab-row-test-kit'
import { workspacePath, workspacesPath } from '../../shared/workspaces'
import { byRole, queryByRole } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { MOUNTED_TEST_TIMEOUT } from '../../test-support/mount'
import { openPaletteTab } from '../palette/palette-test-kit'
import { click, press, settle, typeText } from '../test-mount'
import { menuItem, requestsFor, rowLink } from './row-menu-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { org, workspace } = FAKE_IDS
/** The open workspace: Checkout address autocomplete. */
const open = routes.workspace(org, workspace)
const path = workspacePath(org, 'apple-pay')

/** The reply of a rename of Apple Pay button. */
function renamed(name: string) {
  const { workspaces, detail } = workspaceFixtures()
  const applePay = workspaces.workspaces.find((item) => item.id === 'apple-pay')
  if (!applePay) throw new Error('The fixture has no Apple Pay button.')
  return { ...detail, workspace: { ...applePay, name } }
}

/** Opens the field of Rename of a row from its menu. */
function startRename(workspaceId: string): HTMLInputElement {
  rightClick(rowLink(workspaceId), { clientX: 120, clientY: 300 })
  click(menuItem('Rename'))
  const field = byRole('textbox', 'Workspace name')
  if (!(field instanceof HTMLInputElement)) throw new Error('No name field.')
  return field
}

/** Double-clicks a row, as a mouse does: two clicks, then a double click. */
function doubleClick(link: HTMLElement, init: MouseEventInit = {}): void {
  const send = (type: string, detail: number) =>
    act(() => {
      link.dispatchEvent(
        new MouseEvent(type, {
          ...init,
          detail,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
  act(() => link.focus())
  send('click', 1)
  send('click', 2)
  send('dblclick', 2)
}

/** Presses a key while an input method composes a word in the field. */
function composingKey(field: HTMLInputElement, key: string): void {
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
}

/** The texts of the toasts that show, in their order. */
function toasts(): string[] {
  const shown = document.querySelectorAll(
    '[role="region"][aria-label="Notifications"] :is([role="alert"], [role="status"])',
  )
  return Array.from(shown, (toast) => String(toast.textContent))
}

/** The bodies of the writes of the name of Apple Pay button. */
async function nameWrites(server: FakeApiServer): Promise<unknown[]> {
  const writes = server.requests.filter(
    (request) => request.method === 'PATCH' && request.url.endsWith(path),
  )
  return Promise.all(writes.map((request) => request.json()))
}

describe('Rename of a workspace row', () => {
  test('saves the trimmed name once while another workspace is open, leaves Enter and Escape to a composing input method, and Escape, an empty name, and the same name close the field with no request', async () => {
    const server = new FakeApiServer()
    const { workspaces } = workspaceFixtures().workspaces
    server.json('GET', workspacesPath(org), {
      workspaces: workspaces.map((item): Workspace =>
        item.id === 'pricing-copy' ? { ...item, name: null } : item,
      ),
    })
    server.json('PATCH', path, renamed('Apple Pay on checkout'))
    const { navigation } = await openPaletteTab(open, { server })

    const field = startRename('apple-pay')
    const opened = {
      value: field.value,
      selection: [field.selectionStart, field.selectionEnd],
      focus: document.activeElement === field,
    }
    // While an input method composes a word, Enter and Escape belong to it.
    typeText(field, 'Apple Pay 決済')
    composingKey(field, 'Enter')
    composingKey(field, 'Escape')
    expect({
      open: queryByRole('textbox', 'Workspace name') === field,
      value: field.value,
      writes: await nameWrites(server),
    }).toEqual({ open: true, value: 'Apple Pay 決済', writes: [] })
    press(field, 'Escape')
    const escaped = {
      field: queryByRole('textbox', 'Workspace name'),
      focus: document.activeElement === rowLink('apple-pay'),
    }
    typeText(startRename('apple-pay'), '   ')
    press(byRole('textbox', 'Workspace name'), 'Enter')
    typeText(startRename('apple-pay'), ' Apple Pay button ')
    press(byRole('textbox', 'Workspace name'), 'Enter')
    const unnamed = startRename('pricing-copy').value
    press(byRole('textbox', 'Workspace name'), 'Escape')
    const cancels = await nameWrites(server)

    const saving = startRename('apple-pay')
    typeText(saving, '  Apple Pay on checkout  ')
    press(saving, 'Enter')
    act(() => saving.blur())
    await settle()

    expect({
      opened,
      escaped,
      cancels,
      unnamed,
      writes: await nameWrites(server),
      row: rowLink('apple-pay').textContent,
      focus: document.activeElement === rowLink('apple-pay'),
      history: navigation.history,
      open: requestsFor(server, workspace).filter((line) =>
        line.startsWith('PATCH'),
      ),
    }).toEqual({
      opened: {
        value: 'Apple Pay button',
        selection: [0, 16],
        focus: true,
      },
      escaped: { field: null, focus: true },
      cancels: [],
      unnamed: '',
      writes: [{ name: 'Apple Pay on checkout' }],
      row: 'Apple Pay on checkout5m, Checks failed, Ready',
      focus: true,
      history: [open],
      open: [],
    })
  })

  test('a plain double click on a row opens the workspace once and the field with the name selected, and the field keeps the focus after the chat shows; a double click with a modifier key opens no field', async () => {
    const server = new FakeApiServer()
    const { navigation } = await openPaletteTab(open, { server })
    doubleClick(rowLink('pricing-copy'), { ctrlKey: true })
    const modified = {
      field: queryByRole('textbox', 'Workspace name'),
      history: [...navigation.history],
    }

    doubleClick(rowLink('apple-pay'))
    await settle()
    const field = byRole('textbox', 'Workspace name')
    if (!(field instanceof HTMLInputElement)) throw new Error('No name field.')
    const opened = {
      value: field.value,
      selection: [field.selectionStart, field.selectionEnd],
      focus: document.activeElement === field,
      history: navigation.history,
    }
    press(field, 'Escape')

    expect({
      modified,
      opened,
      closed: queryByRole('textbox', 'Workspace name'),
      writes: await nameWrites(server),
    }).toEqual({
      modified: { field: null, history: [open] },
      opened: {
        value: 'Apple Pay button',
        selection: [0, 16],
        focus: true,
        history: [open, routes.workspace(org, 'apple-pay')],
      },
      closed: null,
      writes: [],
    })
  })

  test('a failed save keeps the typed name for another try and names the failure in a toast', async () => {
    const server = new FakeApiServer()
    server.json(
      'PATCH',
      path,
      { error: { code: 'server_error', message: 'The request failed.' } },
      500,
    )
    await openPaletteTab(open, { server })
    const field = startRename('apple-pay')
    typeText(field, 'Apple Pay on checkout')
    press(field, 'Enter')
    await settle()
    const failed = {
      field: queryByRole('textbox', 'Workspace name') === field,
      value: field.value,
      toasts: toasts(),
    }
    server.json('PATCH', path, renamed('Apple Pay on checkout'))
    press(field, 'Enter')
    await settle()

    expect({
      failed,
      writes: await nameWrites(server),
      field: queryByRole('textbox', 'Workspace name'),
      row: rowLink('apple-pay').textContent,
    }).toEqual({
      failed: {
        field: true,
        value: 'Apple Pay on checkout',
        toasts: ["The workspace wasn't renamed.The request failed."],
      },
      writes: [
        { name: 'Apple Pay on checkout' },
        { name: 'Apple Pay on checkout' },
      ],
      field: null,
      row: 'Apple Pay on checkout5m, Checks failed, Ready',
    })
  })
})
