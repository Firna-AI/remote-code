import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom

import { act, useState } from 'react'
import { describe, expect, test } from 'vitest'
import { groupWorkspaces } from '../../app/sections'
import type { Section } from '../../shared/sections'

import { byRole } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { click, mountScreen, settle } from '../test-mount'
import { startedApp } from '../test-render'
import { SectionList } from './SectionList'

const general: Section = {
  id: 'general',
  orgId: FAKE_IDS.org,
  name: 'General',
  position: 0,
  isDefault: true,
  collapsed: false,
}
/** The fixture list in one section, with one workspace archived already. */
const start: readonly Workspace[] = workspaceFixtures()
  .workspaces.workspaces.slice(0, 4)
  .map((item, index) =>
    index === 3
      ? { ...item, sectionId: general.id, state: 'archived', archivedAt: 1 }
      : { ...item, sectionId: general.id },
  )
const [first, second, , kept] = start as Workspace[]

const noActions = {
  toggle: () => undefined,
  rename: () => undefined,
  moveTo: () => undefined,
  newWorkspace: () => undefined,
  newSection: () => undefined,
  remove: () => undefined,
}

/** The list with the open workspace and the rows that the test changes. */
async function mountList() {
  const app = await startedApp(new FakeApiServer())
  const set: {
    open?: (id: string) => void
    archive?: (id: string) => void
  } = {}
  function Harness() {
    const [selectedId, setSelectedId] = useState(first?.id ?? null)
    const [rows, setRows] = useState(start)
    set.open = setSelectedId
    set.archive = (id) =>
      setRows((items) =>
        items.map((item) =>
          item.id === id
            ? { ...item, state: 'archived', archivedAt: FAKE_TIME }
            : item,
        ),
      )
    const groups = groupWorkspaces([general], rows)
    return (
      <SectionList
        actions={noActions}
        archived={groups.archived}
        groups={groups.sections}
        move={() => undefined}
        now={FAKE_TIME}
        readOnly={false}
        selectedId={selectedId}
        variant="sidebar"
      />
    )
  }
  const view = mountScreen(app, <Harness />)
  await settle()
  const toggle = () =>
    byRole('region', 'Archived', view).querySelector('button')
  return {
    open: (id: string) => act(() => set.open?.(id)),
    archive: (id: string) => act(() => set.archive?.(id)),
    expanded: () => toggle()?.getAttribute('aria-expanded'),
    toggle: () => click(toggle() as HTMLElement),
  }
}

describe('the Archived group', () => {
  test('stays as it was when the open workspace is archived, and opens for a workspace that is archived when it opens', async () => {
    if (!first || !second || !kept) throw new Error('The fixture is short.')
    const list = await mountList()
    const before = list.expanded()
    list.archive(first.id)
    const archivedClosed = list.expanded()
    list.open(kept.id)
    const openedArchived = list.expanded()
    list.open(second.id)
    const left = list.expanded()
    list.toggle()
    list.archive(second.id)
    const archivedOpen = list.expanded()
    expect({
      before,
      archivedClosed,
      openedArchived,
      left,
      archivedOpen,
    }).toEqual({
      before: 'false',
      archivedClosed: 'false',
      openedArchived: 'true',
      left: 'false',
      archivedOpen: 'true',
    })
  })
})
