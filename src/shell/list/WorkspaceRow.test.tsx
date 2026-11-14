import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import { describe, expect, test } from 'vitest'
import styles from '../../../docs/mockups/src/components/workspaces/WorkspaceRow.module.css'

import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { renderScreen, startedApp, textOf } from '../test-render'
import { WorkspaceRow } from './WorkspaceRow'

/** The classes of the link of a row, from its HTML. */
function linkClasses(html: string): string[] {
  return /<a [^>]*class="([^"]*)"/.exec(html)?.[1].split(' ') ?? []
}

describe('WorkspaceRow', () => {
  test('shows Untitled for a workspace with no name', async () => {
    const app = await startedApp(new FakeApiServer())
    const { workspace } = workspaceFixtures().detail
    const html = renderScreen(
      app,
      <WorkspaceRow
        now={FAKE_TIME}
        selected={false}
        variant="sidebar"
        workspace={{ ...workspace, name: null, updatedAt: FAKE_TIME }}
      />,
    )
    expect(textOf(html)).toBe('Untitled now , Ready to merge, Ready')
  })

  test('shows the name of an unread row in bold, and the name of a ready row with the same GitHub state in the normal weight', async () => {
    const app = await startedApp(new FakeApiServer())
    const { workspace } = workspaceFixtures().detail
    const strong = (state: WorkspaceState) =>
      linkClasses(
        renderScreen(
          app,
          <WorkspaceRow
            now={FAKE_TIME}
            selected={false}
            variant="sidebar"
            workspace={{ ...workspace, state }}
          />,
        ),
      ).includes(styles.strong)
    expect({ unread: strong('unread'), ready: strong('ready') }).toEqual({
      unread: true,
      ready: false,
    })
  })
})
