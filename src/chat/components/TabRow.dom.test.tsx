import type { Session } from '../../shared/generated/Session'
// @vitest-environment happy-dom
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import tabScroll from '../../../docs/mockups/src/components/workspace/TabScroll.module.css'
import { testNavigation } from '../../files/files-test-kit'
import { sessionPath } from '../../shared/sessions'
import {
  byRole,
  byText,
  queryByRole,
  queryByText,
} from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import {
  MOUNTED_TEST_TIMEOUT,
  press,
  pressKey,
  typeText,
  waitFor,
} from '../../test-support/mount'
import { RowLayout, widthsByText } from './row-layout-test-kit'
import {
  debounce,
  file,
  fileTabs,
  first,
  mountChat,
  pointer,
  rowStatus,
  savedOrders,
  second,
  settle,
  shownTab,
} from './tab-drag-test-kit'
import { fillRow, rightClick, tabList, turnWheel } from './tab-row-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

/** The record of an open session of the fake workspace. */
function recordOf(id: string): Session {
  const records = workspaceFixtures().sessions.sessions
  const record = records.find((item) => item.id === id)
  if (!record) throw new Error(`The fake workspace has no session ${id}.`)
  return record
}

/** Another member opens or closes a session: the stream brings its record. */
function streamRecord(server: FakeApiServer, session: Session) {
  act(() => {
    server.events.emit({
      workspaceId: FAKE_IDS.workspace,
      eventNumber: server.events.history().throughEventNumber + 1,
      occurredAt: FAKE_TIME,
      event: { type: 'session.updated', session },
    })
  })
}

/** The Worker renames the shown session: its reply holds the new title. */
function answerRename(server: FakeApiServer, title: string) {
  const record = recordOf(FAKE_IDS.session)
  server.json(
    'PATCH',
    sessionPath(FAKE_IDS.org, FAKE_IDS.workspace, record.id),
    {
      session: { ...record, title },
      eventNumber: server.events.history().throughEventNumber,
    },
  )
}

/** Presses Enter in a field: the browser submits the form of the field. */
function submit(field: HTMLElement) {
  act(() => field.closest('form')?.requestSubmit())
}

describe('a full tab row', () => {
  it('scrolls sideways on a vertical wheel turn, leaves a sideways swipe and a turn past its end to the browser, and fades each end that clips tabs', async () => {
    await mountChat({
      server: new FakeApiServer(),
      tabs: [first, second],
      viewport: 'desktop',
    })
    const list = tabList()
    const tab = byRole('button', debounce)
    // 200 px of a row whose tabs take 500 px: it scrolls up to 300 px.
    fillRow(list, 200, 500)
    const steps: { left: number; free: boolean; fades: string[] }[] = []
    const turn = (init: WheelEventInit) => {
      const free = turnWheel(tab, init)
      const fades = [
        list.classList.contains(tabScroll.fadeStart) ? 'start' : null,
        list.classList.contains(tabScroll.fadeEnd) ? 'end' : null,
      ].filter((fade) => fade !== null)
      steps.push({ left: list.scrollLeft, free, fades })
    }

    turn({ deltaY: 100 })
    turn({ deltaX: 60, deltaY: 10 })
    turn({ deltaY: 400 })
    turn({ deltaY: 100 })
    turn({ deltaY: -1000 })

    expect(steps).toEqual([
      { left: 100, free: false, fades: ['start', 'end'] },
      { left: 100, free: true, fades: ['start', 'end'] },
      { left: 300, free: false, fades: ['start'] },
      { left: 300, free: true, fades: ['start'] },
      { left: 0, free: false, fades: ['end'] },
    ])
  })

  it('scrolls the shown tab into view at the mount and when another tab shows, the moved tab after a move, and the shown tab again when the row gets narrower', async () => {
    // Three tabs of 100 px in a row of 200 px: it scrolls up to 100 px.
    const layout = new RowLayout(
      200,
      widthsByText({
        [debounce]: 100,
        'app-[redacted].ts': 100,
        'Address autocomplete': 100,
      }),
    )
    await mountChat({
      server: new FakeApiServer(),
      tabs: [second, file, first],
      viewport: 'desktop',
      renderTab: fileTabs(testNavigation()),
    })
    const list = tabList()
    const steps: number[] = []
    const step = async () => {
      await settle()
      layout.settle()
      steps.push(list.scrollLeft)
    }

    await step()
    await press(byRole('button', debounce))
    await step()
    rightClick(byText('app-[redacted].ts'), { clientX: 150, clientY: 12 })
    await press(byRole('menuitem', 'Move right'))
    await step()
    layout.width = 150
    await step()

    expect({ steps, shown: shownTab() }).toEqual({
      steps: [100, 0, 100, 0],
      shown: debounce,
    })
  })

  it('scrolls a tab that another member opens into view as far as the shown tab still shows, and keeps the shown tab whole when another member closes a tab before it', async () => {
    const server = new FakeApiServer()
    const layout = new RowLayout(
      200,
      widthsByText({
        [debounce]: 60,
        'Address autocomplete': 80,
        'Postcode rules': 100,
        'Checkout copy': 150,
      }),
    )
    await mountChat({ server, tabs: [second, first], viewport: 'desktop' })
    const list = tabList()
    const steps: number[] = []
    const open = async (id: string, title: string) => {
      const record = recordOf(FAKE_IDS.session)
      streamRecord(server, { ...record, id, title, createdAt: FAKE_TIME })
      await waitFor(() => queryByText(title), `the tab of ${title}`)
      layout.settle()
      steps.push(list.scrollLeft)
    }

    layout.settle()
    steps.push(list.scrollLeft)
    // It fits beside the shown tab, so the row scrolls to it.
    await open('postcode', 'Postcode rules')
    // It does not fit beside the shown tab, so the row keeps the shown tab.
    await open('copy', 'Checkout copy')
    // The shown tab moves 60 px to the left, past the start of the row.
    streamRecord(server, { ...recordOf('debounce'), closedAt: FAKE_TIME })
    await waitFor(() => !queryByText(debounce), 'the closed tab')
    layout.settle()
    steps.push(list.scrollLeft)

    expect({ steps, shown: shownTab() }).toEqual({
      steps: [0, 40, 40, 0],
      shown: 'Address autocomplete',
    })
  })

  it('keeps the whole shown tab in view after a rename makes it wider, and leaves the row where the user scrolled it while that tab keeps its size and its place', async () => {
    const layout = new RowLayout(
      200,
      widthsByText({
        [debounce]: 150,
        'Address autocomplete': 120,
        // The tab with the rename field.
        '': 120,
        'Address autocomplete for checkout': 200,
      }),
    )
    const server = new FakeApiServer()
    answerRename(server, 'Address autocomplete for checkout')
    await mountChat({ server, tabs: [second, first], viewport: 'desktop' })
    layout.settle()
    const list = tabList()
    const atMount = list.scrollLeft

    rightClick(byRole('button', 'Address autocomplete'), {
      clientX: 150,
      clientY: 12,
    })
    await press(byRole('menuitem', 'Rename session'))
    layout.settle()
    const field = byRole('textbox', 'Session name')
    await typeText(field, 'Address autocomplete for checkout')
    submit(field)
    await settle()
    layout.settle()
    const renamed = list.scrollLeft

    turnWheel(list, { deltaY: -500 })
    const scrolled = list.scrollLeft
    rightClick(byRole('button', debounce), {
      clientX: 20,
      clientY: 12,
    })
    await pressKey('Escape')
    layout.width = 260
    layout.settle()

    expect({ atMount, renamed, scrolled, after: list.scrollLeft }).toEqual({
      atMount: 70,
      renamed: 150,
      scrolled: 0,
      after: 0,
    })
  })

  it('scrolls near its clipped end while a finger that moved after its long press drags a phone tab, and the release drops the tab at the place that the status says, with no tab menu', async () => {
    // Two tabs of 150 px in a row of 200 px: the row clips the second tab.
    const layout = new RowLayout(
      200,
      widthsByText({ 'Address autocomplete': 150, [debounce]: 150 }),
    )
    const server = new FakeApiServer()
    await mountChat({ server, tabs: [first, second], viewport: 'mobile' })
    layout.settle()
    const finger = { pointerType: 'touch', pointerId: 2, clientX: 75 }
    const frames = (count: number) => {
      for (let frame = 0; frame < count; frame += 1) {
        act(() => {
          vi.advanceTimersToNextFrame()
        })
      }
      return { left: tabList().scrollLeft, status: rowStatus() }
    }

    vi.useFakeTimers()
    try {
      pointer(byRole('button', 'Address autocomplete'), 'pointerdown', finger)
      act(() => vi.advanceTimersByTime(450))
      // A move of 115 px toward the clipped end, more than the 8 px of a
      // move. 10 px from the end, the pointer is 22 px into the 32 px zone
      // of the edge scroll: the row scrolls 9 of the 12 px of a full step.
      pointer(window, 'pointermove', { ...finger, clientX: 190 })
      const firstFrame = frames(1)
      const atEnd = frames(11)
      pointer(window, 'pointerup', { ...finger, clientX: 190, buttons: 0 })
      vi.useRealTimers()
      await settle()

      expect({
        firstFrame,
        atEnd,
        sheet: queryByRole('dialog', 'Address autocomplete') !== null,
        saved: await savedOrders(server),
      }).toEqual({
        firstFrame: {
          left: 9,
          status: 'Moving Address autocomplete to place 1 of 2',
        },
        atEnd: {
          left: 100,
          status: 'Moving Address autocomplete to place 2 of 2',
        },
        sheet: false,
        saved: [[second, first]],
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
