import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { ChangeModelResponse } from '../../shared/sessions'
import { chatFor, newSessionRecord, opensSession } from './test-kit'

const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}
const codex: AgentChoice = {
  agent: 'codex',
  model: 'GPT-6.1 Sol',
  effort: 'medium',
  fast: false,
}
const empty = 'empty-session'
const shortly = { timeout: 10_000 }
const isModel = (request: Request) =>
  request.method === 'PUT' && request.url.endsWith('/model')

type Answer = (request: Request) => Promise<Response | null>

/**
 * Answers each model change as the backend does for a session with no turn.
 * The server took the change after each event that the tab has, so the reply
 * carries a newer event number.
 */
const staysInSession: Answer = async (request) => {
  if (!isModel(request)) return null
  const reply: ChangeModelResponse = {
    eventNumber: 1_000,
    session: newSessionRecord(empty, codex),
    created: false,
    draft: { text: 'Check the postcode rules.', attachmentIds: [] },
  }
  return Response.json(reply)
}

/** A chat with a new session that has no message, and a draft in it. */
async function emptySessionChat(answer: Answer) {
  const chat = chatFor({ conversation: 'history', hold: isModel, answer })
  await chat.controller.start()
  chat.emit({
    type: 'session.updated',
    session: newSessionRecord(empty, opus),
  })
  await chat.controller.select(empty)
  chat.controller.setDraft(empty, 'Check the postcode rules.')
  const picking = chat.controller.chooseModel(empty, codex)
  await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
  const reply = async () => {
    chat.held.splice(0, 1)[0]()
    await picking
  }
  return { chat, reply }
}

const choiceOf = (chat: ReturnType<typeof chatFor>, sessionId: string) =>
  chat.controller
    .getSnapshot()
    .sessions.find((session) => session.id === sessionId)?.choice

describe('a model of the other agent in a session with no message', () => {
  it('shows the new agent at once and keeps the session and its draft', async () => {
    const { chat, reply } = await emptySessionChat(staysInSession)
    expect(choiceOf(chat, empty)).toEqual(codex)
    const before = chat.controller.getSnapshot().sessions.length
    await reply()
    const snapshot = chat.controller.getSnapshot()
    expect(snapshot.sessions).toHaveLength(before)
    expect(snapshot.activeSessionId).toBe(empty)
    expect(choiceOf(chat, empty)).toEqual(codex)
    expect(chat.draftOf(empty)?.text).toBe('Check the postcode rules.')
  })

  it('moves the draft when the server opens a session after all', async () => {
    const { chat, reply } = await emptySessionChat(opensSession(codex))
    await reply()
    const snapshot = chat.controller.getSnapshot()
    expect(choiceOf(chat, empty)).toEqual(opus)
    expect(snapshot.activeSessionId).toBe('client-1')
    expect(choiceOf(chat, 'client-1')).toEqual(codex)
    expect(chat.draftOf('client-1')?.text).toBe('Check the postcode rules.')
    expect(chat.draftOf(empty)?.text).toBe('')
  })
})
