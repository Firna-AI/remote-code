import type { TranscriptDetail } from '../../shared/generated/TranscriptDetail'
// @vitest-environment happy-dom
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { testServices } from '../../app/test-kit'
import { chatHistoryPath } from '../../shared/events'
import { sessionTranscriptPath } from '../../shared/sessions'
import { byRole, queryByRole } from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { MOUNTED_TEST_TIMEOUT, press, waitFor } from '../../test-support/mount'
import {
  debounce,
  first,
  layOut,
  liftedCopy,
  mountChat,
  pointer,
  rowStatus,
  second,
  shownTab,
  viewSaves,
} from './tab-drag-test-kit'
import { allowed, menuItems, rightClick } from './tab-row-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

/** The second session of the fixtures, which no test shows. */
const sessionId = workspaceFixtures('ready').sessions.sessions[1].id

/** The Markdown that the fake route gives for each copy of that session. */
const markdown: Readonly<Record<TranscriptDetail, string>> = {
  concise: '# Debounce lookups\n\n_3 tool calls_\n',
  full: '# Debounce lookups\n\n- Read `src/lookup.ts`\n',
}

const transcriptPath = (detail: TranscriptDetail) =>
  sessionTranscriptPath(FAKE_IDS.org, FAKE_IDS.workspace, sessionId, detail)

/** The services of the app, whose clipboard keeps each copied text. */
function clipboard(server: FakeApiServer) {
  const copied: string[] = []
  const services = testServices(server, {
    copy: async (text) => {
      copied.push(await text)
    },
  })
  return { copied, services }
}

/** The path and the query of each transcript that the chat asked for. */
function transcriptReads(server: FakeApiServer): string[] {
  return server.requests.flatMap((request) => {
    const url = new URL(request.url)
    return url.pathname.endsWith('/transcript')
      ? [`${url.pathname}${url.search}`]
      : []
  })
}

/** The reads of the stored history of the copied session. */
function historyReads(server: FakeApiServer): number {
  const history = new URL(
    chatHistoryPath(FAKE_IDS.org, FAKE_IDS.workspace, sessionId),
    FAKE_ORIGIN,
  )
  return server.requests.filter((request) => {
    const url = new URL(request.url)
    return (
      url.pathname === history.pathname &&
      url.searchParams.get('sessionId') === sessionId
    )
  }).length
}

/** The writes that the fake API got. */
const writes = (server: FakeApiServer) =>
  server.requests.filter((request) => request.method !== 'GET').length

/** The titles of the toasts that show. */
function toasts(): string[] {
  const region = queryByRole('region', 'Notifications')
  if (!region) return []
  return Array.from(
    region.querySelectorAll('[role="status"], [role="alert"]'),
    (toast) => toast.textContent ?? '',
  )
}

const toastShows = () => toasts().length > 0

describe('a copy of a transcript', () => {
  it('asks for the full text of a tab that never showed, copies the reply, says "Transcript copied", and keeps the shown tab, the view, and the loaded history', async () => {
    const server = new FakeApiServer()
    const { copied, services } = clipboard(server)
    server.json('GET', transcriptPath('full'), { markdown: markdown.full })
    await mountChat({
      server,
      tabs: [first, second],
      viewport: 'desktop',
      copy: services,
    })
    const tab = byRole('button', debounce)
    layOut(byRole('button', 'Address autocomplete'), tab)

    rightClick(tab, { clientX: 150, clientY: 12 })
    await press(byRole('menuitem', 'Copy full transcript'))
    await waitFor(toastShows, 'the toast of the copy')

    expect({
      reads: transcriptReads(server),
      copied,
      toasts: toasts(),
      menu: menuItems(debounce),
      shown: shownTab(),
      viewSaves: viewSaves(server).length,
      historyReads: historyReads(server),
    }).toEqual({
      reads: [transcriptPath('full')],
      copied: [markdown.full],
      toasts: ['Transcript copied'],
      menu: [],
      shown: 'Address autocomplete',
      viewSaves: 0,
      historyReads: 0,
    })
  })

  it('says "The transcript didn\'t copy. Try again." when the request fails, and copies nothing', async () => {
    const server = new FakeApiServer()
    const { copied, services } = clipboard(server)
    server.json(
      'GET',
      transcriptPath('full'),
      { error: { code: 'internal', message: 'The server failed.' } },
      500,
    )
    await mountChat({
      server,
      tabs: [first, second],
      viewport: 'desktop',
      copy: services,
    })

    rightClick(byRole('button', debounce), { clientX: 150, clientY: 12 })
    await press(byRole('menuitem', 'Copy full transcript'))
    await waitFor(toastShows, 'the toast of the copy')

    expect({
      reads: transcriptReads(server),
      copied,
      toasts: toasts(),
      shown: shownTab(),
    }).toEqual({
      reads: [transcriptPath('full')],
      copied: [],
      toasts: ["The transcript didn't copy. Try again."],
      shown: 'Address autocomplete',
    })
  })

  it('opens only Copy link and the copy items of an archived workspace on a phone after a long press that lifts no tab, and copies the concise text with the shown tab kept', async () => {
    const server = new FakeApiServer({ workspaceState: 'archived' })
    const { copied, services } = clipboard(server)
    server.json('GET', transcriptPath('concise'), {
      markdown: markdown.concise,
    })
    await mountChat({
      server,
      tabs: [first, second],
      viewport: 'mobile',
      copy: services,
    })
    const tab = byRole('button', debounce)
    const finger = { pointerType: 'touch', pointerId: 2, clientX: 150 }
    const fingerClick = { bubbles: true, cancelable: true, detail: 1 }
    const sheet = () => queryByRole('dialog', debounce) !== null

    vi.useFakeTimers()
    let scroll: { sheet: boolean }
    let hold: { status: string; lifted: boolean; browserMenu: boolean }
    let release: { sheet: boolean; click: boolean }
    try {
      // A finger that moves first scrolls the row, and opens nothing.
      pointer(tab, 'pointerdown', finger)
      pointer(window, 'pointermove', { ...finger, clientX: 170 })
      act(() => vi.advanceTimersByTime(450))
      pointer(window, 'pointerup', { ...finger, clientX: 170, buttons: 0 })
      scroll = { sheet: sheet() }

      pointer(tab, 'pointerdown', finger)
      act(() => vi.advanceTimersByTime(450))
      hold = {
        status: rowStatus(),
        lifted: liftedCopy(debounce),
        browserMenu: rightClick(tab),
      }
      pointer(window, 'pointerup', { ...finger, buttons: 0 })
      act(() => vi.advanceTimersByTime(20))
      // The click of the finger after it lets go selects nothing.
      const click = allowed(tab, new MouseEvent('click', fingerClick))
      release = { sheet: sheet(), click }
    } finally {
      vi.useRealTimers()
    }
    const opened = {
      menu: menuItems(debounce),
      lines: queryByRole('menu', debounce)?.querySelectorAll('hr').length,
      shown: shownTab(),
    }

    await press(byRole('menuitem', 'Copy concise transcript'))
    await waitFor(toastShows, 'the toast of the copy')

    expect({
      scroll,
      hold,
      release,
      opened,
      reads: transcriptReads(server),
      copied,
      toasts: toasts(),
      sheet: sheet(),
      shown: shownTab(),
      writes: writes(server),
    }).toEqual({
      scroll: { sheet: false },
      hold: { status: '', lifted: false, browserMenu: false },
      release: { sheet: true, click: false },
      opened: {
        menu: [
          { name: 'Copy link', off: false },
          { name: 'Copy concise transcript', off: false },
          { name: 'Copy full transcript', off: false },
        ],
        lines: 0,
        shown: 'Address autocomplete',
      },
      reads: [transcriptPath('concise')],
      copied: [markdown.concise],
      toasts: ['Transcript copied'],
      sheet: false,
      shown: 'Address autocomplete',
      writes: 0,
    })
  })
})
