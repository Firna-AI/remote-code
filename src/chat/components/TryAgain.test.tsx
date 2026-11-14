import { describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '../../shared/generated/UserMessage'
import type { ChatEvent } from '../../shared/chat-events'
import {
  chatHistoryPath,
  type WorkspaceEventEnvelope,
} from '../../shared/events'
import { sessionsPath } from '../../shared/sessions'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { recordedChatEvents } from '../../test-support/recorded-chat'
import { count, failed, recordNaming, turn } from './event-kit'
import { renderChat } from './render-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const fixtures = workspaceFixtures()
const shortly = { timeout: 10_000 }

/** A message of a session, which the Worker accepted. */
function accepted(id: string, sessionId: string, text: string): ChatEvent {
  return {
    type: 'message.accepted',
    message: { ...fixtures.message, id, sessionId, text },
  }
}

/** The start of a turn with the messages that it takes. */
function started(sessionId: string, turnId: string, message: UserMessage) {
  return {
    sessionId,
    turnId,
    type: 'turn.started',
    senderId: message.sender.id,
    choice: message.choice,
    startedAt: FAKE_TIME,
    messageIds: [message.id],
  } satisfies ChatEvent
}

/** A stored event of the workspace, as a history reply holds it. */
function stored(eventNumber: number, event: ChatEvent): WorkspaceEventEnvelope {
  return { workspaceId: ws, eventNumber, occurredAt: FAKE_TIME, event }
}

/** The history request of one session. */
function historyOf(request: Request, sessionId: string): boolean {
  const url = new URL(request.url)
  return (
    url.pathname.endsWith('/history') &&
    url.searchParams.get('sessionId') === sessionId
  )
}

describe('Try again on a failed turn', () => {
  it('shows only on the failed item that the newest session record names', async () => {
    const { chat, text } = await renderChat({ conversation: 'running' })
    chat.emit(failed('turn-1', 'The first turn failed.', 'ask'))
    expect(count(text(), 'Try again')).toBe(0)

    chat.emit(recordNaming(chat.controller, 'ask'))
    expect(text()).toContain('The first turn failed. Try again')

    const next = { ...fixtures.message, id: 'ask-2' }
    chat.emit(accepted(next.id, turn.sessionId, 'Use the other proxy.'))
    chat.emit(recordNaming(chat.controller, null))
    expect(count(text(), 'Try again')).toBe(0)

    chat.emit(started(turn.sessionId, 'turn-2', next))
    chat.emit(failed('turn-2', 'The second turn failed.', next.id))
    chat.emit(recordNaming(chat.controller, next.id))
    expect(text()).toContain('The second turn failed. Try again')
    expect(count(text(), 'Try again')).toBe(1)
  })

  it('takes the record of the session list over an older record of the history', async () => {
    // The history ends with a failure that its record names. Then another
    // member sent a message, so the list that the chat reads next names none.
    const [shown] = fixtures.sessions.sessions
    const recorded = recordedChatEvents('failed')
    const through = recorded.length + 1
    const events = [
      ...recorded,
      stored(through, {
        type: 'session.updated',
        session: { ...shown, retryMessageId: 'ask' },
      }),
    ]
    const { text } = await renderChat({
      conversation: 'failed',
      setup: (server) => {
        // The list holds the state after that message, which is newer.
        server.json('GET', sessionsPath(org, ws), {
          ...fixtures.sessions,
          eventNumber: through + 1,
        })
        server.json('GET', chatHistoryPath(org, ws, shown.id), {
          events,
          throughEventNumber: through,
        })
      },
    })
    // The recorded error says "Try again." itself, and no button follows it.
    expect(text()).toContain('This turn stopped The agent is busy. Try again.')
    expect(count(text(), 'Try again')).toBe(1)
  })

  it('keeps a newer live record when the history of the session loads after it', async () => {
    const debounce = 'debounce'
    const { chat, text } = await renderChat({
      conversation: 'history',
      hold: (request) => historyOf(request, debounce),
    })
    // The history was read before the newer events of the session.
    const first = fixtures.message
    chat.server.json('GET', chatHistoryPath(org, ws, debounce), {
      events: [
        stored(1, accepted(first.id, debounce, first.text)),
        stored(2, recordNaming(chat.controller, null, debounce)),
      ],
      throughEventNumber: chat.server.events.history().throughEventNumber,
    })
    const selecting = chat.controller.select(debounce)
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)

    const ask = { ...fixtures.message, id: 'ask-d', sessionId: debounce }
    chat.emit(accepted(ask.id, debounce, 'Debounce the lookups.'))
    chat.emit(recordNaming(chat.controller, null, debounce))
    chat.emit(started(debounce, 'turn-d', ask))
    chat.emit({
      ...failed('turn-d', 'The lookups failed.', ask.id),
      sessionId: debounce,
    })
    chat.emit(recordNaming(chat.controller, ask.id, debounce))
    chat.held.splice(0, 1)[0]()
    await selecting

    const shown = text()
    expect(shown).toContain(
      `${first.text} Debounce the lookups. This turn stopped The lookups failed. Try again`,
    )
    expect(count(shown, 'Try again')).toBe(1)
  })

  it('takes a newer record from a history that the stream has not reached yet', async () => {
    const debounce = 'debounce'
    const { chat, text } = await renderChat({ conversation: 'history' })
    const reached = chat.server.events.history().throughEventNumber
    const ask = { ...fixtures.message, id: 'ask-d', sessionId: debounce }
    chat.emit(accepted(ask.id, debounce, 'Debounce the lookups.'))
    chat.emit(started(debounce, 'turn-d', ask))
    chat.emit({
      ...failed('turn-d', 'The lookups failed.', ask.id),
      sessionId: debounce,
    })
    chat.emit(recordNaming(chat.controller, ask.id, debounce))
    // Another member sent a message. The history has it, the stream not yet.
    const live = chat.server.events.history(reached).events
    const newer = reached + live.length
    chat.server.json('GET', chatHistoryPath(org, ws, debounce), {
      events: [
        ...live,
        stored(newer + 1, accepted('ask-d2', debounce, 'Use 300 ms instead.')),
        stored(newer + 2, recordNaming(chat.controller, null, debounce)),
      ],
      throughEventNumber: newer + 2,
    })
    await chat.controller.select(debounce)

    const shown = text()
    expect(shown).toContain('The lookups failed. Use 300 ms instead.')
    expect(count(shown, 'Try again')).toBe(0)
  })
})
