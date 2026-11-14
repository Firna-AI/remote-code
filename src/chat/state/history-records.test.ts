import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { chatHistoryPath } from '../../shared/events'
import { sessionsPath } from '../../shared/sessions'
import {
  workspaceViewPath,
  type WorkspaceView,
} from '../../shared/workspace-view'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { chatFor, newSessionRecord } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const id = 'debounce'
const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}

describe('session records from stored history', () => {
  it('keeps current tabs and selection while first-load history brings an older close and reopen', async () => {
    const first = newSessionRecord(FAKE_IDS.session, opus)
    const second = newSessionRecord(id, opus)
    const nextPage = chatHistoryPath(org, ws, first.id, 33, 40)
    const chat = chatFor({
      conversation: 'history',
      hold: (request) =>
        request.method === 'GET' && request.url.endsWith(nextPage),
    })
    const view: WorkspaceView = {
      tabs: [
        { kind: 'session', sessionId: first.id },
        { kind: 'session', sessionId: id },
      ],
      activeTab: { kind: 'session', sessionId: first.id },
      fileList: 'changes',
      temporaryTab: null,
      tool: 'terminal',
    }
    chat.server.json('GET', workspaceViewPath(org, ws), { view })
    chat.server.json('GET', sessionsPath(org, ws), {
      eventNumber: 30,
      sessions: [first, second],
      history: [],
    })
    const envelope = (eventNumber: number, closedAt: number | null) => ({
      workspaceId: ws,
      eventNumber,
      occurredAt: FAKE_TIME,
      event: {
        type: 'session.updated',
        session: { ...first, closedAt },
      },
    })
    chat.server.json('GET', chatHistoryPath(org, ws, first.id), {
      events: [envelope(33, null)],
      throughEventNumber: 40,
      hasMore: true,
      nextBeforeEventNumber: 33,
    })
    chat.server.json('GET', nextPage, {
      events: [envelope(29, null), envelope(31, FAKE_TIME)],
      throughEventNumber: 40,
    })
    const loading = chat.controller.start()
    await loading
    const history = chat.server.requests
      .map((request) => new URL(request.url))
      .find((url) => url.searchParams.get('sessionId') === first.id)
    expect(Object.fromEntries(history?.searchParams ?? [])).toEqual({
      sessionId: first.id,
    })
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), {
      timeout: 10_000,
    })
    const duringHistory = chat.controller.getSnapshot()
    const complete = chat.controller.loadHistory(first.id)
    chat.held.splice(0, 1)[0]()
    await complete
    const snapshot = chat.controller.getSnapshot()
    expect(duringHistory.view).toEqual(view)
    expect(duringHistory.sessions.map((session) => session.id)).toEqual([
      'autocomplete',
      'debounce',
    ])
    expect(duringHistory.activeSessionId).toBe('autocomplete')
    expect(snapshot.sessions.map((session) => session.id)).toEqual([
      'autocomplete',
      'debounce',
    ])
    expect(snapshot.view).toEqual(view)
    expect(snapshot.activeSessionId).toBe('autocomplete')
  })

  it('keeps both first-load lists complete when history publishes the shown record first', async () => {
    const chat = chatFor({ conversation: 'history' })
    const first = newSessionRecord(FAKE_IDS.session, opus)
    const second = newSessionRecord(id, opus)
    const closed = newSessionRecord('closed', opus, FAKE_TIME)
    chat.server.json('GET', sessionsPath(org, ws), {
      eventNumber: 0,
      sessions: [first, second],
      history: [closed],
    })
    const newest = { ...first, title: 'Title from first history' }
    const eventNumber = chat.nextEventNumber()
    chat.server.json('GET', chatHistoryPath(org, ws, first.id), {
      events: [
        {
          workspaceId: ws,
          eventNumber,
          occurredAt: FAKE_TIME,
          event: { type: 'session.updated', session: newest },
        },
      ],
      throughEventNumber: eventNumber,
    })
    await chat.controller.start()
    const snapshot = chat.controller.getSnapshot()
    expect(snapshot.sessions).toEqual([newest, second])
    expect(snapshot.history).toEqual([closed])
    expect(snapshot.activeSessionId).toBe(first.id)
    expect(snapshot.load).toEqual({ state: 'ready' })
  })

  it.each(['ready', 'failed'] as const)(
    'shows a newer history record when the history ends as %s, before its socket copy',
    async (hydration) => {
      const chat = chatFor({ conversation: 'history' })
      await chat.controller.start()
      const session = chat.controller
        .getSnapshot()
        .sessions.find((item) => item.id === id)
      if (!session) throw new Error('The second session did not load.')
      const eventNumber = chat.nextEventNumber()
      const envelope = {
        workspaceId: ws,
        eventNumber,
        occurredAt: FAKE_TIME,
        event: {
          type: 'session.updated' as const,
          session: { ...session, title: 'New history title' },
        },
      }
      chat.server.json('GET', chatHistoryPath(org, ws, id), {
        events: [envelope],
        throughEventNumber: eventNumber + 1,
        ...(hydration === 'failed'
          ? { hasMore: true, nextBeforeEventNumber: eventNumber }
          : {}),
      })
      chat.server.json(
        'GET',
        chatHistoryPath(org, ws, id, eventNumber, eventNumber + 1),
        {
          error: {
            code: 'internal_error',
            message: 'The request failed. Try again.',
          },
        },
        500,
      )
      await chat.controller.select(id)
      const title = () =>
        chat.controller.getSnapshot().sessions.find((item) => item.id === id)
          ?.title
      expect(title()).toBe('New history title')
      expect(chat.controller.getSnapshot().sessionStates[id].hydration).toBe(
        hydration,
      )
      chat.server.events.emit(envelope)
      expect(title()).toBe('New history title')
      expect(chat.controller.getSnapshot().activeSessionId).toBe(id)
    },
  )
})
