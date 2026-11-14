import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { sessionPath, sessionPaths } from '../../shared/sessions'
import { workspaceViewPath } from '../../shared/workspace-view'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { chatFor, shown } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const id = FAKE_IDS.session
const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}
const shortly = { timeout: 10_000 }

describe('session records', () => {
  it('keeps a session closed when an older rename reply arrives after the close', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) => request.method === 'PATCH',
    })
    await chat.controller.start()
    const renaming = chat.controller.rename(id, 'Lookups')
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    const renamed = chat.controller.getSnapshot().sessions[0]
    // The server renamed the session first, then closed it.
    const after = chat.nextEventNumber()
    chat.server.json('POST', sessionPaths.close(org, ws, id), {
      session: { ...renamed, closedAt: FAKE_TIME + 1 },
      eventNumber: after + 1,
    })
    await chat.controller.requestClose(id)
    chat.server.json('PATCH', sessionPath(org, ws, id), {
      session: renamed,
      eventNumber: after,
    })
    chat.held.splice(0, 1)[0]()
    await renaming
    const snapshot = chat.controller.getSnapshot()
    expect(snapshot.sessions.map((session) => session.id)).toEqual(['debounce'])
    expect(snapshot.history[0]).toMatchObject({
      id,
      title: 'Lookups',
      closedAt: FAKE_TIME + 1,
    })
  })

  it('keeps a newer record from the stream over an older model reply and its rollback', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) =>
        request.method === 'PUT' && request.url.endsWith('/model'),
    })
    await chat.controller.start()
    const [session] = chat.controller.getSnapshot().sessions
    const model = sessionPaths.model(org, ws, id)
    const sonnet: AgentChoice = { ...opus, model: 'Sonnet 5.5' }
    const fable: AgentChoice = { ...opus, model: 'Fable 5.1' }
    const choice = () => chat.controller.getSnapshot().sessions[0].choice
    const answered = chat.controller.chooseModel(id, sonnet)
    // Another tab changed the model after the server took this change.
    const changed = chat.nextEventNumber()
    chat.emit({
      type: 'session.updated',
      session: { ...session, choice: fable },
    })
    chat.server.json('PUT', model, {
      session: { ...session, choice: sonnet },
      created: false,
      draft: { text: '', attachmentIds: [] },
      eventNumber: changed - 1,
    })
    chat.held.splice(0, 1)[0]()
    await answered
    expect(choice()).toEqual(fable)
    const failed = chat.controller.chooseModel(id, sonnet)
    chat.emit({
      type: 'session.updated',
      session: { ...session, choice: opus, title: 'Renamed elsewhere' },
    })
    chat.server.json(
      'PUT',
      model,
      {
        error: {
          code: 'internal_error',
          message: 'The request failed. Try again.',
        },
      },
      500,
    )
    chat.held.splice(0, 1)[0]()
    await failed
    expect(chat.controller.getSnapshot().sessions[0]).toMatchObject({
      choice: opus,
      title: 'Renamed elsewhere',
    })
  })

  it('keeps a reopened session shown when one stream batch brings its older close and its reopen', async () => {
    const chat = chatFor({ conversation: 'history' })
    await chat.controller.start()
    const closed = chat.controller.getSnapshot().history[0]
    const reopened = { ...closed, closedAt: null }
    const next = chat.nextEventNumber()
    chat.server.json('POST', sessionPaths.reopen(org, ws, closed.id), {
      session: reopened,
      eventNumber: next + 1,
    })
    await chat.controller.reopen(closed.id)
    expect(chat.controller.getSnapshot().activeSessionId).toBe(closed.id)
    const envelope = (eventNumber: number, closedAt: number | null) => ({
      workspaceId: ws,
      eventNumber,
      occurredAt: FAKE_TIME,
      event: {
        type: 'session.updated' as const,
        session: { ...closed, closedAt },
      },
    })
    chat.server.events.emit(envelope(next + 1, null))
    chat.server.events.emit(envelope(next, FAKE_TIME + 1))
    const snapshot = chat.controller.getSnapshot()
    expect(snapshot.activeSessionId).toBe(closed.id)
    expect(snapshot.sessions.map((session) => session.id)).toContain(closed.id)
  })

  it('keeps the steps of a close and a reopen whose records the stream brought first', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) =>
        request.method === 'POST' && /\/(close|reopen)$/.test(request.url),
    })
    await chat.controller.start()
    const [session] = chat.controller.getSnapshot().sessions
    const closedRecord = { ...session, closedAt: FAKE_TIME + 1 }
    chat.server.json('POST', sessionPaths.close(org, ws, id), {
      session: closedRecord,
      eventNumber: chat.nextEventNumber(),
    })
    const closing = chat.controller.requestClose(id)
    chat.emit({ type: 'session.updated', session: closedRecord })
    chat.held.splice(0, 1)[0]()
    await closing
    const views = () => chat.bodies('PUT', workspaceViewPath(org, ws))
    expect((await views()).at(-1)).toMatchObject({
      tabs: [{ kind: 'session', sessionId: 'debounce' }],
      activeTab: { kind: 'session', sessionId: 'debounce' },
    })
    expect(shown(chat.controller, 'debounce')).toHaveLength(4)
    chat.server.json('POST', sessionPaths.reopen(org, ws, id), {
      session,
      eventNumber: chat.nextEventNumber(),
    })
    const reopening = chat.controller.reopen(id)
    chat.emit({ type: 'session.updated', session })
    chat.held.splice(0, 1)[0]()
    await reopening
    expect(chat.controller.getSnapshot().activeSessionId).toBe(id)
    expect((await views()).at(-1)).toMatchObject({
      activeTab: { kind: 'session', sessionId: id },
    })
  })
})
