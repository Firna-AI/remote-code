import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { pickChatFiles } from './draft-files.test-support'
import { filePaths } from '../../shared/files'
import { retryMessagePath, sessionPaths } from '../../shared/sessions'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { record, text } from '../api/json'
import { chatFor, opensSession, shown } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const id = FAKE_IDS.session
const messages = sessionPaths.messages(org, ws, id)
const model = sessionPaths.model(org, ws, id)
const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}

describe('ChatController actions', () => {
  it('accepts a message before the sandbox is ready, and shows it as queued until it is sent', async () => {
    const chat = chatFor({
      workspaceState: 'starting',
      conversation: 'history',
    })
    await chat.controller.start()
    chat.controller.setDraft(id, 'Also add tests.')
    const queued = {
      id: 'client-1',
      sessionId: id,
      sender: {
        id: 'cal',
        githubLogin: 'calummoore',
        displayName: 'Cal',
        avatarUrl: null,
      },
      text: 'Also add tests.',
      attachments: [],
      choice: opus,
      createdAt: FAKE_TIME,
      state: 'queued' as const,
    }
    // The reply names the session that took the message, as the Worker does.
    const session = chat.controller
      .getSnapshot()
      .sessions.find((item) => item.id === id)
    chat.server.json(
      'POST',
      messages,
      {
        message: queued,
        turnId: null,
        session,
        eventNumber: chat.nextEventNumber(),
      },
      202,
    )
    await chat.controller.send(id)
    expect(await chat.bodies('POST', messages)).toEqual([
      {
        id: 'client-1',
        text: 'Also add tests.',
        attachmentIds: [],
        choice: opus,
      },
    ])
    const state = () => chat.controller.getSnapshot().sessionStates[id]
    expect(state().pending).toEqual([queued])
    expect(state().draft.text).toBe('')
    chat.emit({ type: 'message.accepted', message: queued })
    expect(state().pending).toEqual([])
    chat.emit({
      type: 'message.sent',
      sessionId: id,
      messageId: 'client-1',
      turnId: 'turn-2',
    })
    const last = state().transcript.items.at(-1)
    expect(last?.kind === 'user' ? last.message.state : null).toBe('sent')
  })

  it('shows an answer with every message that it answers, also one sent during the turn', async () => {
    const chat = chatFor({ conversation: 'steer' })
    await chat.controller.start()
    expect(shown(chat.controller, id)).toEqual([
      'user: Add address autocomplete to the checkout form. Keep the manual fields as a fallback.',
      'tool: src/app/checkout/AddressForm.tsx done',
      'user: Also debounce the lookups to 250 ms.',
      'agent: The form now suggests addresses and waits 250 ms between lookups.',
      'end: 270000',
    ])
  })

  it('shows no message for an ID that no person sent, such as one that the agent SDK added', async () => {
    const chat = chatFor({ conversation: 'history' })
    await chat.controller.start()
    const before = shown(chat.controller, id)
    const turn = { sessionId: id, turnId: 'turn-2' }
    chat.emit({
      ...turn,
      type: 'turn.started',
      senderId: 'cal',
      choice: opus,
      startedAt: FAKE_TIME,
      messageIds: ['sdk-added'],
    })
    chat.emit({
      ...turn,
      type: 'turn.completed',
      state: 'stopped',
      durationMs: 1_000,
      files: [],
      omittedFileCount: 0,
      userMessageIds: ['sdk-added'],
    })
    expect(shown(chat.controller, id)).toEqual([...before, 'stopped by nobody'])
  })

  it('shows a stopped turn as stopped, and the next message continues the same session', async () => {
    const chat = chatFor({ conversation: 'interrupted' })
    await chat.controller.start()
    expect(shown(chat.controller, id).slice(-2)).toEqual([
      'tool: npm test stopped',
      'stopped by cal',
    ])
    chat.controller.setDraft(id, 'Run only the unit tests.')
    await chat.controller.send(id)
    expect(chat.requests('POST', messages)).toHaveLength(1)
  })

  it('names the cause of a failed turn, and Try again posts the retry of its message', async () => {
    const chat = chatFor({ conversation: 'failed' })
    await chat.controller.start()
    expect(shown(chat.controller, id).at(-1)).toBe(
      'failed: The agent is busy. Try again.',
    )
    await chat.controller.retry(id, 'ask')
    expect(
      chat.requests('POST', retryMessagePath(org, ws, id, 'ask')),
    ).toHaveLength(1)
  })

  it('moves the draft, with edits made during the request, to the session that another agent opens', async () => {
    const codex: AgentChoice = {
      agent: 'codex',
      model: 'GPT-6.1 Sol',
      effort: 'medium',
      fast: false,
    }
    const chat = chatFor({
      conversation: 'history',
      hold: (request) => request.method === 'PUT',
      answer: opensSession(codex),
    })
    await chat.controller.start()
    chat.controller.setDraft(id, 'Check the postcode rules')
    const picking = chat.controller.chooseModel(id, codex)
    chat.controller.setDraft(id, 'Check the postcode rules for the UK')
    chat.held.splice(0, 1)[0]()
    await picking
    const [body] = await chat.bodies('PUT', model)
    const created = text(record(body).newSessionId)
    const snapshot = chat.controller.getSnapshot()
    expect(snapshot.activeSessionId).toBe(created)
    expect(snapshot.sessionStates[created].draft.text).toBe(
      'Check the postcode rules for the UK',
    )
    expect(snapshot.sessionStates[id].draft.text).toBe('')
  })

  it('keeps the later of two model picks when their answers arrive in reverse order', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) => request.method === 'PUT',
    })
    await chat.controller.start()
    const [session] = chat.controller.getSnapshot().sessions
    const sonnet: AgentChoice = { ...opus, model: 'Sonnet 5.5' }
    const fable: AgentChoice = { ...opus, model: 'Fable 5.1' }
    // The server takes the picks in their order, so the later one is newer.
    const after = chat.nextEventNumber()
    const answer = (choice: AgentChoice, eventNumber: number) =>
      chat.server.json('PUT', model, {
        session: { ...session, choice },
        created: false,
        draft: { text: '', attachmentIds: [] },
        eventNumber,
      })
    const first = chat.controller.chooseModel(id, sonnet)
    const second = chat.controller.chooseModel(id, fable)
    answer(fable, after + 1)
    chat.held.splice(1, 1)[0]()
    await second
    expect(chat.controller.getSnapshot().sessions[0].choice).toEqual(fable)
    answer(sonnet, after)
    chat.held.splice(0, 1)[0]()
    await first
    expect(chat.controller.getSnapshot().sessions[0].choice).toEqual(fable)
  })

  it('waits for a file that uploads before it sends, so the message carries the file', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) =>
        request.method === 'POST' &&
        new URL(request.url).pathname === filePaths.attachments(org, ws),
    })
    await chat.controller.start()
    chat.controller.setDraft(id, 'The suggestions cover the postcode.')
    const uploading = pickChatFiles(chat, id, [
      new File(['png'], 'overlap.png', { type: 'image/png' }),
    ])
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), {
      timeout: 10_000,
    })
    await chat.controller.send(id)
    expect(chat.requests('POST', messages)).toHaveLength(0)
    chat.held.splice(0, 1)[0]()
    await uploading
    await chat.controller.send(id)
    const [sent] = await chat.bodies('POST', messages)
    expect(sent).toMatchObject({ attachmentIds: ['attachment-1'] })
    expect(chat.requests('POST', filePaths.attachments(org, ws))).toHaveLength(
      1,
    )
  })
})
