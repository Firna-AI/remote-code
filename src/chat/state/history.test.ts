import type { Session } from '../../shared/generated/Session'
import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { chatHistoryPath } from '../../shared/events'

import { sessionsPath } from '../../shared/sessions'
import { FAKE_IDS, FAKE_TIME, fakeUser } from '../../test-support/fixtures/core'
import { senderSnapshot } from '../../test-support/fixtures/workspaces'
import { recordedChatEvents } from '../../test-support/recorded-chat'
import { chatFor, shown } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}
const recordedHistory = [
  'user: Add address autocomplete to the checkout form. Keep the manual fields as a fallback.',
  'agent: The checkout form now suggests addresses. Manual entry still works.',
  'tool: src/app/checkout/AddressForm.tsx done',
  'end: 252000',
]
const shortly = { timeout: 10_000 }

function record(id: string, closedAt: number | null): Session {
  return {
    id,
    workspaceId: ws,
    title: 'Places proxy timeouts',
    choice: opus,
    createdAt: FAKE_TIME - 1_000,
    closedAt,
    activeTurnId: null,
    activeTurnStartedAt: null,
    retryMessageId: null,
    startedBy: senderSnapshot(fakeUser),
    sourceSessionId: null,
    loginAvailable: true,
    loginShared: true,
  }
}

describe('session history', () => {
  it('shows the workspace and the composer, then starts live events after the newest page while earlier history waits', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) =>
        new URL(request.url).searchParams.get('sessionId') === 'autocomplete',
    })
    const events = recordedChatEvents('history', ws, 'autocomplete')
    chat.server.json('GET', chatHistoryPath(org, ws, 'autocomplete'), {
      events: events.filter(({ eventNumber }) => eventNumber >= 8),
      throughEventNumber: 11,
      hasMore: true,
      nextBeforeEventNumber: 8,
    })
    chat.server.json('GET', chatHistoryPath(org, ws, 'autocomplete', 8, 11), {
      events: events.filter(({ eventNumber }) => eventNumber < 8),
      throughEventNumber: 11,
    })
    const loaded = chat.controller.start()
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    const loading = chat.controller.getSnapshot()
    expect(loading.load.state).toBe('ready')
    expect(loading.workspace).not.toBeNull()
    expect(loading.sessionStates.autocomplete.hydration).toBe('loading')
    expect(chat.after).toEqual([])
    const complete = chat.controller.loadHistory('autocomplete')
    chat.held.splice(0, 1)[0]()
    await loaded
    expect(chat.after).toEqual([11])
    expect(shown(chat.controller, 'autocomplete')).toEqual([
      recordedHistory[1],
      recordedHistory[3],
    ])
    expect(
      chat.controller.getSnapshot().sessionStates.autocomplete.hydration,
    ).toBe('loading')
    expect(chat.requests('GET', sessionsPath(org, ws))).toHaveLength(2)
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    chat.held.splice(0, 1)[0]()
    await complete
    const state = chat.controller.getSnapshot().sessionStates.autocomplete
    expect(state.hydration).toBe('ready')
    expect(shown(chat.controller, 'autocomplete')).toEqual(recordedHistory)
  })

  it('loads the stored history of the session that a close from another tab shows', async () => {
    const chat = chatFor({ conversation: 'history' })
    await chat.controller.start()
    const [first] = chat.controller.getSnapshot().sessions
    chat.emit({
      type: 'session.updated',
      session: { ...first, closedAt: FAKE_TIME + 1 },
    })
    expect(chat.controller.getSnapshot().activeSessionId).toBe('debounce')
    expect(chat.histories('debounce')).toBe(1)
    const history = chat.server.requests
      .map((request) => new URL(request.url))
      .find((url) => url.searchParams.get('sessionId') === 'debounce')
    expect(Object.fromEntries(history?.searchParams ?? [])).toEqual({
      sessionId: 'debounce',
    })
    await vi.waitFor(
      () => expect(shown(chat.controller, 'debounce')).toEqual(recordedHistory),
      shortly,
    )
  })

  it('loads the stored history of a session that another tab opens while no session is open', async () => {
    const chat = chatFor({ conversation: 'history' })
    chat.server.json('GET', sessionsPath(org, ws), {
      eventNumber: 0,
      sessions: [],
      history: [record('proxy-timeouts', FAKE_TIME)],
    })
    await chat.controller.start()
    expect(chat.controller.getSnapshot().activeSessionId).toBeNull()
    chat.emit({
      type: 'session.updated',
      session: record('proxy-timeouts', null),
    })
    expect(chat.controller.getSnapshot().activeSessionId).toBe('proxy-timeouts')
    expect(chat.histories('proxy-timeouts')).toBe(1)
    await vi.waitFor(
      () =>
        expect(shown(chat.controller, 'proxy-timeouts')).toEqual(
          recordedHistory,
        ),
      shortly,
    )
  })

  it('shares one running history load for each session, also after the chat starts again', async () => {
    const chat = chatFor({ conversation: 'history' })
    await chat.controller.start()
    expect(chat.histories('autocomplete')).toBe(1)
    chat.controller.stop()
    await chat.controller.start()
    expect(chat.histories('autocomplete')).toBe(2)
    const first = chat.controller.select('debounce')
    await chat.controller.select('debounce')
    expect(shown(chat.controller, 'debounce')).toEqual(recordedHistory)
    await first
    expect(chat.histories('debounce')).toBe(1)
  })

  it('tries a failed history again only when the user asks', async () => {
    const chat = chatFor({ conversation: 'history' })
    const history = chatHistoryPath(org, ws, 'debounce')
    chat.server.json(
      'GET',
      history,
      {
        error: {
          code: 'internal_error',
          message: 'The request failed. Try again.',
        },
      },
      500,
    )
    await chat.controller.start()
    await chat.controller.select('debounce')
    const state = () => chat.controller.getSnapshot().sessionStates.debounce
    expect(state().hydration).toBe('failed')
    chat.controller.setDraft('debounce', 'Hello')
    chat.emit({ type: 'workspace.title', name: 'Checkout' })
    expect(chat.histories('debounce')).toBe(1)
    const events = recordedChatEvents('history', ws, 'debounce')
    chat.server.json('GET', history, {
      events,
      throughEventNumber: events.length,
    })
    await chat.controller.loadHistory('debounce')
    expect(chat.histories('debounce')).toBe(2)
    expect(shown(chat.controller, 'debounce')).toEqual(recordedHistory)
  })

  it('reads a later shown session newest first, before each cursor, with the cutoff of the first page', async () => {
    const chat = chatFor({ conversation: 'history' })
    const events = recordedChatEvents('history', ws, 'debounce')
    const page = (numbers: readonly number[], next?: number) => ({
      events: events.filter(({ eventNumber }) => numbers.includes(eventNumber)),
      throughEventNumber: 9,
      ...(next === undefined
        ? {}
        : { hasMore: true, nextBeforeEventNumber: next }),
    })
    // The pages leave out the running state of the tool, which its end replaces.
    chat.server.json(
      'GET',
      chatHistoryPath(org, ws, 'debounce'),
      page([8, 9], 8),
    )
    chat.server.json(
      'GET',
      chatHistoryPath(org, ws, 'debounce', 8, 9),
      page([7], 7),
    )
    chat.server.json(
      'GET',
      chatHistoryPath(org, ws, 'debounce', 7, 9),
      page([1, 2, 3, 4, 5]),
    )
    await chat.controller.start()
    await chat.controller.select('debounce')
    expect(shown(chat.controller, 'debounce')).toEqual(recordedHistory)
    const reads = chat.server.requests
      .map((request) => new URL(request.url))
      .filter((url) => url.searchParams.get('sessionId') === 'debounce')
      .map((url) => [
        url.searchParams.get('before'),
        url.searchParams.get('through'),
      ])
    expect(reads).toEqual([
      [null, null],
      ['8', '9'],
      ['7', '9'],
    ])
    const state = chat.controller.getSnapshot().sessionStates.debounce
    expect(state.hydration).toBe('ready')
  })

  it('fails a history whose page does not move the read back, and asks for no more pages', async () => {
    const stuck = {
      events: [],
      throughEventNumber: 9,
      hasMore: true,
      nextBeforeEventNumber: 4,
    }
    let reads = 0
    const chat = chatFor({
      conversation: 'history',
      answer: async (request) => {
        const url = new URL(request.url)
        if (url.searchParams.get('sessionId') !== 'debounce') return null
        reads += 1
        // A third read would end the history. A sound reader never sends it.
        return Response.json(
          reads < 3 ? stuck : { events: [], throughEventNumber: 9 },
        )
      },
    })
    await chat.controller.start()
    await chat.controller.select('debounce')
    expect(chat.controller.getSnapshot().sessionStates.debounce.hydration).toBe(
      'failed',
    )
    expect(chat.histories('debounce')).toBe(2)
  })
})
