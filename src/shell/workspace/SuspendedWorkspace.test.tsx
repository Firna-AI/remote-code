import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
// @vitest-environment happy-dom

import { describe, expect, test, vi } from 'vitest'

import { requestLines } from '../../app/test-kit'
import { queryByRole } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, fakeUser } from '../../test-support/fixtures/core'
import { MOUNTED_TEST_TIMEOUT } from '../../test-support/mount'
import { serveSuspendedAcme } from '../../test-support/suspended-org'
import { mountScreen, settle } from '../test-mount'
import { startedApp } from '../test-render'
import { WorkspaceScreen } from './WorkspaceScreen'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const orgWords =
  'This org is suspended. For questions, write to abuse@conductive.build.'

/** Opens the workspace of Acme while the operator suspended Acme. */
async function openSuspended(workspaceState: WorkspaceState) {
  const server = new FakeApiServer({ workspaceState })
  serveSuspendedAcme(server)
  const app = await startedApp(server)
  const org = app.orgs.get().find((item) => item.id === FAKE_IDS.org)
  if (!org) throw new Error('The fake org is missing.')
  const view = mountScreen(
    app,
    <WorkspaceScreen
      org={org}
      view={[]}
      viewer={fakeUser}
      workspaceId={FAKE_IDS.workspace}
    />,
  )
  await settle()
  return { server, view }
}

/** How often a text shows in the screen. */
function count(view: HTMLElement, text: string): number {
  return (view.textContent ?? '').split(text).length - 1
}

describe('a workspace of a suspended org', () => {
  test('shows the refused bar of the org while the stop of its cloud computer runs, and offers no Resume, Archive, or new access', async () => {
    const { server, view } = await openSuspended('ready')
    expect({
      bar: count(view, orgWords),
      refused: count(view, "The sandbox can't start"),
      panels: count(view, 'Your chat history is available.'),
      stopped: count(view, 'Sandbox stopped'),
      archive: queryByRole('button', 'Archive workspace', view) !== null,
      resume: queryByRole('button', 'Resume', view) !== null,
      writes: requestLines(server).filter((line) => !line.startsWith('GET ')),
    }).toEqual({
      bar: 1,
      refused: 3,
      panels: 2,
      stopped: 0,
      archive: false,
      resume: false,
      writes: [],
    })
  })

  test('an archived workspace shows the notice of the org above its archived bar', async () => {
    const { view } = await openSuspended('archived')
    const text = view.textContent ?? ''
    const notice = text.indexOf('Acme is suspended')
    const archived = text.indexOf('Archived on')
    expect({
      notice: notice >= 0,
      noticeFirst: notice < archived,
      orgWords: text.includes(
        'Its workspaces and settings are read-only. For questions, write to abuse@conductive.build.',
      ),
      archivedFacts: text.includes(
        'The files and the tools went with the cloud computer.',
      ),
    }).toEqual({
      notice: true,
      noticeFirst: true,
      orgWords: true,
      archivedFacts: true,
    })
  })
})
