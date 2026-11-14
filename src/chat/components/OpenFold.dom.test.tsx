import type { Workspace } from '../../shared/generated/Workspace'
// @vitest-environment happy-dom
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '../../app/router'

import {
  accessibleName,
  byText,
  queryByText,
} from '../../test-support/dom-queries'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { MOUNTED_TEST_TIMEOUT, press, waitFor } from '../../test-support/mount'
import {
  bodyOf,
  foldOf,
  lineOf,
  mountFinishedTurn,
  place,
  pressed,
  textIn,
} from './open-fold-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const blocks = [
  'The proxy already returns predictions, so the work is in the form:',
  'Add a useAddressAutocomplete hook',
  'Then, in this order:',
  '1. Fill the other fields',
  '2. Run the tests',
]
const planLine = blocks.join(' ')
const sizes = [
  'The machine has room for more workers:',
  '| Resource | Free |',
  '| --- | ---: |',
  '| CPU | 4 vCPUs | 8 threads |',
  '| Memory | 6.0 GiB |',
  '',
  'Memory stays under 5 GiB.',
].join('\n')
const sizesLine =
  'The machine has room for more workers: Resource · Free · CPU · 4 vCPUs · Memory · 6.0 GiB Memory stays under 5 GiB.'
const timings = [
  '| Workers | Time |',
  '| ---: | ---: |',
  '| 4 | 3m 10s |',
].join('\n')
const timingsLine = 'Workers · Time · 4 · 3m 10s'

describe('an open fold', () => {
  it('lists its steps in order, opens a message line to its full text, and keeps both choices', async () => {
    const { emit } = await mountFinishedTurn()
    const line = byText('2 tool calls, 2 messages')
    expect(foldOf(line).open).toBe(false)

    await press(line)
    const steps = foldOf(line).querySelectorAll(':scope > ul > li')
    expect({
      open: foldOf(line).open,
      steps: Array.from(steps, textIn),
    }).toEqual({
      open: true,
      steps: [
        'I will check the checkout form.',
        'Read src/app/checkout/AddressForm.tsx',
        planLine,
        'Ran npm run lint',
      ],
    })

    const message = lineOf(byText(planLine))
    expect(foldOf(message).open).toBe(false)
    await press(message)
    expect({
      open: foldOf(message).open,
      blocks: blocks.map((block) => queryByText(block, message)?.tagName),
      // A summary holds no paragraph, list, or table, so each block is a
      // span. A heading is a span too: the closed line stays one line, and
      // the button role of a summary hides a heading from the heading list
      // of a screen reader.
      flow: message.querySelectorAll('p, ul, ol, li, pre, div').length,
    }).toEqual({ open: true, blocks: blocks.map(() => 'SPAN'), flow: 0 })

    const next = { ...workspaceFixtures().message, id: 'ask-2' }
    await act(async () =>
      emit({ type: 'message.accepted', message: { ...next, text: 'Thanks.' } }),
    )
    await waitFor(() => queryByText('Thanks.'), 'the next message')
    // The chat draws again, so the test finds both lines again.
    const shown = [byText('2 tool calls, 2 messages'), byText(planLine)]
    expect(shown.map((element) => foldOf(element).open)).toEqual([true, true])
  })

  it('keeps its line in place when the user opens or closes it: a work fold, a run of tool calls, and a message line', async () => {
    await mountFinishedTurn()
    const work = byText('2 tool calls, 2 messages')
    const run = byText('1 tool call')
    place(work, 148, 382)
    place(run, 600, 48)
    expect([
      await pressed(work),
      await pressed(work),
      await pressed(run),
      await pressed(run),
    ]).toEqual([
      { open: true, top: 148 },
      { open: false, top: 148 },
      { open: true, top: 600 },
      { open: false, top: 600 },
    ])

    // The open work fold moves the chat 382 px, so the message line shows
    // at 220 + 382 px.
    await pressed(work)
    const message = lineOf(byText(planLine))
    place(message, 220, 96)
    expect([await pressed(message), await pressed(message)]).toEqual([
      { open: true, top: 602 },
      { open: false, top: 602 },
    ])
  })

  it('shows a message with a table as one line, opens the table and the rest under the line, keeps the line in place, and keeps a name for a line that starts with a table', async () => {
    await mountFinishedTurn({ work: [sizes, timings] })
    const work = byText('2 tool calls, 3 messages')
    await press(work)
    // The message lines of the work, after the recorded message.
    const [, line, first] = foldOf(work).querySelectorAll<HTMLElement>(
      ':scope > ul > li > details > summary',
    )
    place(line, 260, 180)
    const closed = [accessibleName(line), accessibleName(first)]
    const opened = await pressed(line)
    expect({
      closed,
      ...opened,
      name: accessibleName(line),
      // A summary holds no paragraph, list, or table.
      flow: line.querySelectorAll('p, ul, ol, li, pre, div, table').length,
      body: bodyOf(line),
    }).toEqual({
      closed: [sizesLine, timingsLine],
      open: true,
      top: 260,
      name: 'The machine has room for more workers:',
      flow: 0,
      body: [
        [
          ['Resource', 'Free'],
          ['CPU', '4 vCPUs'],
          ['Memory', '6.0 GiB'],
        ],
        'Memory stays under 5 GiB.',
      ],
    })
    expect(await pressed(line)).toEqual({ open: false, top: 260 })

    await press(first)
    expect({ name: accessibleName(first), body: bodyOf(first) }).toEqual({
      name: timingsLine,
      body: [
        [
          ['Workers', 'Time'],
          ['4', '3m 10s'],
        ],
      ],
    })
  })

  it('shows a workspace chip in the table of a message line, and keeps no hidden link in the open line of a message that starts with the table', async () => {
    const linked = workspaceFixtures().workspaces.workspaces[0] as Workspace
    await mountFinishedTurn({
      work: [`| Workspace |\n| --- |\n| ${linked.link} |`],
    })
    const work = byText('2 tool calls, 2 messages')
    await press(work)
    const [, line] = foldOf(work).querySelectorAll<HTMLElement>(
      ':scope > ul > li > details > summary',
    )
    const links = (root: Element) =>
      Array.from(root.querySelectorAll('a'), (link) =>
        link.getAttribute('href'),
      )
    const closed = links(line)
    await press(line)
    const to = routes.workspace(FAKE_IDS.org, linked.id)
    expect({ closed, open: links(line), fold: links(foldOf(line)) }).toEqual({
      closed: [to],
      open: [],
      fold: [to],
    })
  })

  it('lets a workspace chip in a message line open its page, and leaves a click with a modifier key to the browser', async () => {
    const linked = workspaceFixtures().workspaces.workspaces[0] as Workspace
    const opened: string[] = []
    await mountFinishedTurn({
      work: [`Next, compare ${linked.link} too.`],
      onOpenPage: (to) => opened.push(to),
    })
    await press(byText('2 tool calls, 2 messages'))
    const to = routes.workspace(FAKE_IDS.org, linked.id)
    const chip = await waitFor(
      () => document.querySelector<HTMLAnchorElement>(`a[href="${to}"]`),
      'the chip in the message line',
    )
    await press(chip)
    const plain = [...opened]
    // A browser opens the page of a click with a modifier key itself, and
    // toggles no fold for a click on a link in its line.
    const newTab = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    })
    act(() => {
      chip.dispatchEvent(newTab)
    })
    expect({
      plain,
      modified: { kept: newTab.defaultPrevented, opened },
    }).toEqual({
      plain: [to],
      modified: { kept: false, opened: [to] },
    })
  })
})
