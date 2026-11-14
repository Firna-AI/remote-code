import type { Workspace } from '../../shared/generated/Workspace'
import { act } from 'react'
import { routes } from '../../app/router'
import { requestLines } from '../../app/test-kit'
import { workspacePath } from '../../shared/workspaces'
import {
  accessibleName,
  byRole,
  queryByLabel,
  queryByRole,
} from '../../test-support/dom-queries'
import type { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { press } from '../test-mount'

// The helpers of the tests of the menu of a workspace row in the whole app.

const { org } = FAKE_IDS

/** The list of the rows: the sidebar on desktop, or the page on a phone. */
function rows(): ParentNode {
  return queryByLabel('Workspaces') ?? document
}

/** The link of the row of a workspace. */
export function rowLink(workspaceId: string): HTMLAnchorElement {
  const link = rows().querySelector<HTMLAnchorElement>(
    `li a[href="${routes.workspace(org, workspaceId)}"]`,
  )
  if (!link) throw new Error(`The list has no row for ${workspaceId}.`)
  return link
}

/** The Archive shortcut of the row of a workspace. */
export function archiveShortcut(workspaceId: string): HTMLElement {
  const row = rowLink(workspaceId).closest('li')
  if (!row) throw new Error(`The list has no row for ${workspaceId}.`)
  return byRole('button', 'Archive workspace', row)
}

/**
 * The names of the buttons in the rows of the workspaces, each once. A row
 * has no button for its menu, so only the Archive shortcut shows here.
 */
export function rowButtonNames(): string[] {
  const prefix = routes.workspace(org, '')
  const names = Array.from(rows().querySelectorAll('li'))
    .filter((row) => row.querySelector(`a[href^="${prefix}"]`) !== null)
    .flatMap((row) =>
      Array.from(row.querySelectorAll('button, [role="button"]'), (button) =>
        accessibleName(button),
      ),
    )
  return [...new Set(names)]
}

/** Gives an element a box of the window, which happy-dom does not lay out. */
export function placeBox(
  element: Element | null,
  box: { left: number; top: number; width: number; height: number },
): void {
  if (!element) throw new Error('No element to place.')
  const rect = new DOMRect(box.left, box.top, box.width, box.height)
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
}

/**
 * The items of the open menu with this label: their names, and a mark for
 * a checked choice and for an item that shows its choices.
 */
export function menuOf(label: string): string[] {
  const menu = queryByRole('menu', label)
  if (!menu) return []
  return Array.from(menu.querySelectorAll('[role^="menuitem"]'), (item) => {
    const marks = [
      item.getAttribute('aria-checked') === 'true' ? ' (checked)' : '',
      item.getAttribute('aria-haspopup') === 'menu' ? ' >' : '',
    ]
    return `${accessibleName(item)}${marks.join('')}`
  })
}

/** Where the open menu with this label draws: the place of its layer. */
export function menuPlace(label: string): { left: string; top: string } {
  const layer = byRole('menu', label).parentElement
  return { left: layer?.style.left ?? '', top: layer?.style.top ?? '' }
}

/** An item of an open menu, by its name. */
export function menuItem(name: string): HTMLElement {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  ).find((element) => accessibleName(element) === name)
  if (!item) throw new Error(`No menu item "${name}".`)
  return item
}

/** Moves the pointer over an element, as a mouse does. */
export function hover(element: Element): void {
  act(() => {
    element.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerType: 'mouse',
      }),
    )
  })
}

/**
 * Presses Enter on the element with the focus. As a browser does, Enter on
 * a button then clicks it, unless a handler of the key prevented that.
 */
export function pressEnter(): void {
  const target = document.activeElement
  if (!(target instanceof HTMLElement)) throw new Error('Nothing has focus.')
  const event = press(target, 'Enter')
  if (target instanceof HTMLButtonElement && !event.defaultPrevented) {
    act(() => target.click())
  }
}

/** The name of the element with the focus, or its tag. */
export function focusName(): string {
  const active = document.activeElement
  if (!active || active === document.body) return 'nothing'
  return accessibleName(active) || active.tagName
}

/** The requests that named the workspace, after `from` earlier requests. */
export function requestsFor(
  server: FakeApiServer,
  workspaceId: string,
  from = 0,
): string[] {
  const path = workspacePath(org, workspaceId)
  return requestLines(server)
    .slice(from)
    .filter((line) => line.includes(`${path}/`) || line.endsWith(path))
}

/** The reply of a write of Apple Pay button, with `change` applied. */
export function applePayReply(change: Partial<Workspace>) {
  const { workspaces, detail } = workspaceFixtures()
  const applePay = workspaces.workspaces.find((item) => item.id === 'apple-pay')
  if (!applePay) throw new Error('The fixture has no Apple Pay button.')
  return { ...detail, workspace: { ...applePay, ...change } }
}
