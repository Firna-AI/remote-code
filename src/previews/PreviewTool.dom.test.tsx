import type { Preview } from '../shared/generated/Preview'
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceStream } from '../app/events'
import { ManualDelay, RecordingEvents } from '../app/test-kit'
import { ToolEvents } from '../shell/workspace/tools/tool-events'
import { previewsPath } from '../shared/previews'
import {
  accessibleName,
  byLabel,
  byRole,
  byText,
  queryByLabel,
  queryByRole,
  queryByText,
} from '../test-support/dom-queries'
import { FakeApiServer } from '../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../test-support/fixtures/core'
import {
  deferred,
  holdAnimationFrames,
  mount,
  MOUNTED_TEST_TIMEOUT,
  press,
  typeText,
  waitFor,
} from '../test-support/mount'
import { fullReport, refusedReport } from '../test-support/recorded-repairs'
import type { ApiFetch } from '../terminal/tool-parts/request'
import { PreviewTool } from './PreviewTool'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { org, workspace: workspaceId } = FAKE_IDS
const path = previewsPath(org, workspaceId)
const listIntro = 'Open a web server that runs in this sandbox.'
const askForServer =
  'Servers that run in this sandbox show here. Start one in the terminal, or ask the agent.'
const unavailable = 'The latest list of servers is unavailable'

function preview(port: number): Preview {
  return {
    id: `preview-${port}`,
    port,
    url: `https://p${port}a4826b97d1c04f15802c7e9bb2546d30.conductive-previews.test/`,
    expiresAt: FAKE_TIME + 86_400_000,
  }
}

/** The fake API with these open previews. */
function serverWith(previews: readonly Preview[]): FakeApiServer {
  const server = new FakeApiServer()
  server.json('GET', path, { previews })
  return server
}

/**
 * The events of the workspace as the Preview tool reads them in the app:
 * raw socket messages, through the stream and the tool events.
 */
function workspaceEvents() {
  const source = new RecordingEvents()
  const target = { orgId: org, workspaceId }
  const stream = new WorkspaceStream(source, target, new ManualDelay().delay)
  const tools = new ToolEvents()
  tools.follow(stream)
  stream.start()
  source.send({
    type: 'history',
    history: { events: [], throughEventNumber: 0 },
  })
  let last = 0
  const send = (event: object, occurredAt = FAKE_TIME) => {
    last += 1
    const envelope = { workspaceId, eventNumber: last, occurredAt, event }
    source.send({ type: 'event', envelope })
  }
  return { tools, send }
}

/** Mounts the tool with no preview in its address, at FAKE_TIME. */
async function mountTool(fetch: ApiFetch, tools: ToolEvents) {
  const navigate = vi.fn<(previewId: string) => void>()
  await mount(
    <PreviewTool
      now={() => FAKE_TIME}
      route={{ previewId: null, href: (id) => `#${id}`, navigate }}
      touch={false}
      workspace={{ orgId: org, workspaceId, fetch, subscribe: tools.subscribe }}
    />,
  )
  return navigate
}

/** The spoken names of the buttons of the detected servers. */
function serverRows(): string[] {
  const list = byRole('list', 'Servers in this sandbox')
  return Array.from(list.querySelectorAll('button'), accessibleName)
}

const waitForForm = () =>
  waitFor(() => queryByRole('button', 'Open preview'), 'the port form')

/** The text of the port field, and whether it keeps the focus and selection. */
function draftIn(label: string) {
  const field = byLabel(label)
  return field instanceof HTMLInputElement
    ? {
        value: field.value,
        focused: document.activeElement === field,
        selection: [field.selectionStart, field.selectionEnd],
      }
    : null
}

describe('the Preview tool with detected servers', () => {
  it('lists each reported server without a tab after "+", waits while one opens, and opens its port with the open request', async () => {
    holdAnimationFrames()
    const server = serverWith([preview(3000)])
    server.json('POST', path, { preview: preview(4321) }, 201)
    const reply = deferred()
    const fetch: ApiFetch = async (input, init) => {
      if (init?.method === 'POST') await reply.promise
      return server.fetch(input, init)
    }
    const { tools, send } = workspaceEvents()
    // The report comes before the tool shows.
    send(fullReport('ports.updated'))
    const navigate = await mountTool(fetch, tools)
    await press(
      await waitFor(() => queryByRole('button', 'Preview another port'), '+'),
    )

    expect(serverRows()).toEqual([
      'Port 4321, astro dev in docs',
      'Port 4322, astro dev in marketing-site',
      'Port 5173, vite in packages/address-autocomplete/examples/playground',
      'Port 6006, storybook dev in packages/ui',
    ])
    await press(byRole('button', 'Port 4321, astro dev in docs'))
    const rows = byRole('list', 'Servers in this sandbox')
    const waiting = Array.from(
      rows.querySelectorAll('button'),
      (button) => button.disabled,
    )
    reply.resolve()
    await waitFor(() => navigate.mock.calls.length > 0, 'the new preview')

    expect(waiting).toEqual([true, true, true, true])
    const posts = server.requests.filter(({ method }) => method === 'POST')
    expect(await Promise.all(posts.map((post) => post.json()))).toEqual([
      { port: 4321 },
    ])
    expect(navigate.mock.calls).toEqual([['preview-4321']])
  })

  it('shows the field alone without a report, and asks for a server when the runner reports none', async () => {
    holdAnimationFrames()
    const { tools, send } = workspaceEvents()
    await mountTool(serverWith([]).fetch, tools)
    await waitForForm()

    expect(queryByText(listIntro)).not.toBeNull()
    expect(queryByText(askForServer)).toBeNull()
    expect(queryByRole('list', 'Servers in this sandbox')).toBeNull()

    send({ type: 'ports.updated', ports: [] })
    await waitFor(() => queryByText(askForServer), 'the request for a server')
    expect(byLabel('Port')).toBeDefined()
    expect(queryByRole('list', 'Servers in this sandbox')).toBeNull()
  })

  it('keeps a typed port, its focus, and its selection while reports change the form, and opens that port', async () => {
    holdAnimationFrames()
    const server = serverWith([])
    server.json('POST', path, { preview: preview(8080) }, 201)
    const { tools, send } = workspaceEvents()
    const navigate = await mountTool(server.fetch, tools)
    await waitForForm()
    const field = byLabel('Port')
    await typeText(field, '8080')
    if (field instanceof HTMLInputElement) field.setSelectionRange(2, 4)
    const kept = { value: '8080', focused: true, selection: [2, 4] }

    // A server starts, and the form lists it over the Other port row.
    send(fullReport('ports.updated'))
    await waitFor(
      () => queryByRole('list', 'Servers in this sandbox'),
      'the list of servers',
    )
    expect(draftIn('Other port')).toEqual(kept)

    // The servers stop, and the form asks for a server again.
    send({ type: 'ports.updated', ports: [] })
    await waitFor(() => queryByText(askForServer), 'the request for a server')
    expect(draftIn('Port')).toEqual(kept)

    await press(byRole('button', 'Open preview'))
    await waitFor(() => navigate.mock.calls.length > 0, 'the new preview')
    const posts = server.requests.filter(({ method }) => method === 'POST')
    expect(await Promise.all(posts.map((post) => post.json()))).toEqual([
      { port: 8080 },
    ])
    expect(navigate.mock.calls).toEqual([['preview-8080']])
  })

  it('keeps the field, without the request for a server, when each reported server has a tab', async () => {
    holdAnimationFrames()
    const { tools, send } = workspaceEvents()
    send({
      type: 'ports.updated',
      ports: [{ port: 3000, name: 'next dev', folder: null }],
    })
    await mountTool(serverWith([preview(3000)]).fetch, tools)
    await press(
      await waitFor(() => queryByRole('button', 'Preview another port'), '+'),
    )

    expect(queryByText(listIntro)).not.toBeNull()
    expect(queryByText(askForServer)).toBeNull()
    expect(queryByRole('list', 'Servers in this sandbox')).toBeNull()
    expect(byLabel('Port')).toBeDefined()
  })

  it('shows a failed repair of the list with its age under the form, not over a preview, until a later report', async () => {
    holdAnimationFrames()
    const { tools, send } = workspaceEvents()
    send(fullReport('ports.updated'))
    send(refusedReport('ports.updated', false), FAKE_TIME - 240_000)
    send(refusedReport('ports.updated', true, 2), FAKE_TIME - 180_000)
    await mountTool(serverWith([preview(3000)]).fetch, tools)
    const plus = await waitFor(
      () => queryByRole('button', 'Preview another port'),
      '+',
    )

    // The preview of port 3000 fills the frame.
    expect(queryByText(unavailable)).toBeNull()
    await press(plus)
    expect(byText(unavailable)).toBeDefined()
    expect(byText('3m ago')).toBeDefined()
    expect(serverRows()).toHaveLength(4)
    expect(byLabel('Other port')).toBeDefined()

    send({ type: 'ports.updated', ports: null })
    await waitFor(() => !queryByText(unavailable), 'the end of the notice')
    expect(queryByRole('list', 'Servers in this sandbox')).toBeNull()
  })

  it('cuts a long server name in its tab, and gives the tab the whole name and folder', async () => {
    holdAnimationFrames()
    const { tools, send } = workspaceEvents()
    send(fullReport('ports.updated'))
    const previews = [preview(3000), preview(6006), preview(8080)]
    await mountTool(serverWith(previews).fetch, tools)
    const tabs = await waitFor(() => queryByLabel('Previews'), 'the tabs')

    expect(
      Array.from(tabs.querySelectorAll('a'), (tab) => [
        tab.textContent,
        tab.getAttribute('aria-label'),
        tab.getAttribute('title'),
      ]),
    ).toEqual([
      ['3000 next dev', 'Port 3000, next dev', 'Port 3000, next dev'],
      [
        '6006 storybook…',
        'Port 6006, storybook dev in packages/ui',
        'Port 6006, storybook dev in packages/ui',
      ],
      ['Port 8080', null, null],
    ])
  })
})
