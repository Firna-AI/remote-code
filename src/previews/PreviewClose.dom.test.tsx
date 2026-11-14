import type { Preview } from '../shared/generated/Preview'
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { ToolEvents } from '../shell/workspace/tools/tool-events'
import { previewPath, previewsPath } from '../shared/previews'
import {
  byRole,
  queryByLabel,
  queryByRole,
  queryByText,
} from '../test-support/dom-queries'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import {
  holdAnimationFrames,
  mount,
  MOUNTED_TEST_TIMEOUT,
  press,
  waitFor,
} from '../test-support/mount'
import { PreviewTool } from './PreviewTool'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { org, workspace: workspaceId } = FAKE_IDS
const closeError = "The preview of port 8080 couldn't close. Try again later."

function preview(port: number): Preview {
  return {
    id: `preview-${port}`,
    port,
    url: `https://p${port}a4826b97d1c04f15802c7e9bb2546d30.conductive-previews.test/`,
    expiresAt: FAKE_TIME + 86_400_000,
  }
}

/** The text of each tab of the open previews. */
function tabLabels(): string[] {
  const tabs = queryByLabel('Previews')
  if (!tabs) return []
  return Array.from(tabs.querySelectorAll('a'), (tab) => tab.textContent)
}

describe('the Close button of a preview tab', () => {
  it('sits in its tab, closes a preview that is not shown, and names the port of a preview that could not close', async () => {
    holdAnimationFrames()
    const server = new FakeApiServer()
    server.json('GET', previewsPath(org, workspaceId), {
      previews: [preview(3000), preview(8080)],
    })
    const closePath = previewPath(org, workspaceId, 'preview-8080')
    const error = { code: 'unavailable', message: 'Try again later.' }
    server.json('DELETE', closePath, { error }, 503)
    await mount(
      <PreviewTool
        now={() => FAKE_TIME}
        route={{ previewId: null, href: (id) => `#${id}`, navigate: vi.fn() }}
        touch={false}
        workspace={{
          orgId: org,
          workspaceId,
          fetch: server.fetch,
          subscribe: new ToolEvents().subscribe,
        }}
      />,
    )
    await waitFor(() => tabLabels().length === 2, 'the tabs')

    // The toolbar keeps no Close of its own: each tab holds one.
    expect(queryByRole('button', 'Close preview')).toBeNull()
    const close = byRole('button', 'Close Port 8080')
    const tab = queryByLabel('Previews')?.querySelectorAll('a')[1]
    expect(tab?.parentElement?.contains(close)).toBe(true)

    await press(close)
    await waitFor(() => queryByText(closeError), 'the close error')
    expect(tabLabels()).toEqual(['Port 3000', 'Port 8080'])

    server.json('DELETE', closePath, {})
    await press(byRole('button', 'Close Port 8080'))
    await waitFor(() => tabLabels().length === 1, 'the closed tab')

    expect(tabLabels()).toEqual(['Port 3000'])
    expect(queryByText(closeError)).toBeNull()
    const deletes = server.requests.filter(({ method }) => method === 'DELETE')
    expect(await Promise.all(deletes.map((each) => each.json()))).toEqual([
      {},
      {},
    ])
  })
})
