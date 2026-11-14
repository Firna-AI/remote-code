import { describe, expect, it } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { sessionPaths } from '../../shared/sessions'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { record, text } from '../api/json'
import { chatFor, newSessionRecord, opensSession } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const id = FAKE_IDS.session
const model = sessionPaths.model(org, ws, id)
const codex: AgentChoice = {
  agent: 'codex',
  model: 'GPT-6.1 Sol',
  effort: 'medium',
  fast: false,
}

/** Answers each model change in turn: the first answer gets lost on the way. */
function lostThen(next: (request: Request) => Promise<Response | null>) {
  let lost = true
  return async (request: Request): Promise<Response | null> => {
    if (request.method !== 'PUT') return null
    if (!lost) return next(request)
    lost = false
    throw new Error('The connection dropped.')
  }
}

describe('a model change of the other agent after a failed request', () => {
  it('moves the draft once, with the later text, when the record of its session arrives late', async () => {
    const chat = chatFor({
      conversation: 'history',
      answer: lostThen(async () => null),
    })
    await chat.controller.start()
    chat.controller.setDraft(id, 'Check the postcode rules')
    await chat.controller.chooseModel(id, codex)
    expect(chat.controller.getSnapshot().notice?.title).toBe(
      "The model didn't change",
    )
    const [body] = await chat.bodies('PUT', model)
    const created = text(record(body).newSessionId)
    chat.controller.setDraft(id, 'Check the postcode rules for the UK')
    chat.emit({
      type: 'session.updated',
      session: newSessionRecord(created, codex),
    })
    expect(chat.controller.getSnapshot().activeSessionId).toBe(created)
    expect(chat.draftOf(created)?.text).toBe(
      'Check the postcode rules for the UK',
    )
    expect(chat.draftOf(id)?.text).toBe('')
    chat.controller.setDraft(id, 'A new draft')
    chat.emit({
      type: 'session.updated',
      session: { ...newSessionRecord(created, codex), title: 'Renamed' },
    })
    expect(chat.draftOf(id)?.text).toBe('A new draft')
  })

  it('sends the same change again before that record, so the server opens one session', async () => {
    const chat = chatFor({
      conversation: 'history',
      answer: lostThen(opensSession(codex)),
    })
    await chat.controller.start()
    chat.controller.setDraft(id, 'Check the postcode rules')
    await chat.controller.chooseModel(id, codex)
    chat.controller.setDraft(id, 'Check the postcode rules for the UK')
    await chat.controller.chooseModel(id, codex)
    const [first, second] = await chat.bodies('PUT', model)
    expect(second).toEqual(first)
    const created = text(record(first).newSessionId)
    expect(chat.controller.getSnapshot().activeSessionId).toBe(created)
    expect(chat.draftOf(created)?.text).toBe(
      'Check the postcode rules for the UK',
    )
    expect(chat.draftOf(id)?.text).toBe('')
    chat.emit({
      type: 'session.updated',
      session: newSessionRecord(created, codex),
    })
    const opened = chat.controller
      .getSnapshot()
      .sessions.filter((session) => session.choice.agent === 'codex')
    expect(opened.map((session) => session.id)).toEqual([created])
    expect(chat.draftOf(id)?.text).toBe('')
  })

  it('ends a change that the server refused, so a new pick sends a new session ID', async () => {
    let refused = true
    const opens = opensSession(codex)
    const chat = chatFor({
      conversation: 'history',
      answer: async (request) => {
        if (request.method !== 'PUT') return null
        if (!refused) return opens(request)
        refused = false
        const conflict = {
          code: 'session_id_conflict',
          message: 'Open a new session and try again.',
        }
        return Response.json({ error: conflict }, { status: 409 })
      },
    })
    await chat.controller.start()
    chat.controller.setDraft(id, 'Check the postcode rules')
    await chat.controller.chooseModel(id, codex)
    await chat.controller.chooseModel(id, codex)
    const [first, second] = await chat.bodies('PUT', model)
    const ids = [first, second].map((body) => text(record(body).newSessionId))
    expect(ids[1]).not.toBe(ids[0])
    expect(chat.controller.getSnapshot().activeSessionId).toBe(ids[1])
  })
})
