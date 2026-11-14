import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { routes } from '../../app/router'
import { rightClick } from '../../chat/components/tab-row-test-kit'
import { sectionsPath } from '../../shared/sections'
import { workspacesPath } from '../../shared/workspaces'
import { byRole } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import {
  coreFixtures,
  FAKE_IDS,
  FAKE_TIME,
} from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { MOUNTED_TEST_TIMEOUT } from '../../test-support/mount'
import { openPaletteTab } from '../palette/palette-test-kit'
import { click, press, settle } from '../test-mount'
import { menuItem, menuOf, rowLink } from './row-menu-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { org, workspace } = FAKE_IDS
const open = routes.workspace(org, workspace)

/** Serves the list of Acme with the workspaces that `change` gives. */
function serveList(
  server: FakeApiServer,
  change: (workspace: Workspace) => Workspace,
) {
  const { workspaces } = workspaceFixtures().workspaces
  server.json('GET', workspacesPath(org), {
    workspaces: workspaces.map(change),
  })
}

/** The workspace, archived. */
function archived(item: Workspace): Workspace {
  return { ...item, state: 'archived', archivedAt: FAKE_TIME }
}

/** Opens the menu of a row at a point, reads its items, and closes it. */
function itemsOf(workspaceId: string, name: string): string[] {
  rightClick(rowLink(workspaceId), { clientX: 120, clientY: 300 })
  const items = menuOf(name)
  press(document.activeElement ?? document.body, 'Escape')
  return items
}

/** Opens the Archived group, which starts collapsed. */
function openArchived(): void {
  const toggle = byRole('region', 'Archived').querySelector('button')
  if (!toggle) throw new Error('The Archived group has no toggle.')
  click(toggle)
}

describe('the actions of a workspace menu', () => {
  test('a member moves, renames, and copies the link of each row, archives only their own, and gets only Copy link on an archived row', async () => {
    const server = new FakeApiServer({ role: 'member' })
    serveList(server, (item) =>
      item.id === 'webhook-retries' ? archived(item) : item,
    )
    await openPaletteTab(open, { server })
    const own = itemsOf('pricing-copy', 'Pricing page copy')
    const others = itemsOf('apple-pay', 'Apple Pay button')
    openArchived()
    const archivedRow = {
      browserMenu: rightClick(rowLink('webhook-retries')),
      menu: menuOf('Retry failed webhooks'),
    }
    press(document.activeElement ?? document.body, 'Escape')

    expect({ own, others, archivedRow }).toEqual({
      own: ['Move to section >', 'Rename', 'Copy link', 'Archive'],
      others: ['Move to section >', 'Rename', 'Copy link'],
      archivedRow: { browserMenu: false, menu: ['Copy link'] },
    })
  })

  test('an admin reassigns an archived row and copies its link, and a change of the role, the sections, or the workspace drops the actions that it takes away while the menu shows', async () => {
    const server = new FakeApiServer()
    serveList(server, (item) =>
      item.id === 'webhook-retries' ? archived(item) : item,
    )
    const { app } = await openPaletteTab(open, { server })
    openArchived()
    const archivedRow = itemsOf('webhook-retries', 'Retry failed webhooks')

    rightClick(rowLink('apple-pay'), { clientX: 120, clientY: 300 })
    click(menuItem('Reassign to'))
    await settle()
    const owners = menuOf('Owner')
    const acme = app.orgs.get().find((item) => item.id === org)
    if (!acme) throw new Error('The fake org is missing.')
    act(() => app.putOrg({ ...acme, role: 'member' }))
    const asMember = {
      items: menuOf('Apple Pay button'),
      owners: menuOf('Owner'),
    }
    const { sections } = coreFixtures().sectionList
    server.json('GET', sectionsPath(org), {
      sections: sections.filter((section) => section.isDefault),
    })
    await act(() => app.org(org).reload('list'))
    const generalOnly = menuOf('Apple Pay button')
    serveList(server, (item) =>
      item.id === 'apple-pay' ? archived(item) : item,
    )
    await act(() => app.org(org).reload('list'))

    expect({
      archivedRow,
      owners,
      asMember,
      generalOnly,
      archived: menuOf('Apple Pay button'),
    }).toEqual({
      archivedRow: ['Reassign to >', 'Copy link'],
      owners: ['Cal (checked)', 'Priya Raman', 'Jonas Weber'],
      asMember: {
        items: ['Move to section >', 'Rename', 'Copy link', 'Archive'],
        owners: [],
      },
      generalOnly: ['Rename', 'Copy link', 'Archive'],
      archived: ['Copy link'],
    })
  })
})
