import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { fileMark } from '../../app/draft-marks'
import { pickChatFiles } from './draft-files.test-support'
import { readyIds } from '../../app/draft-files'
import { chatHistoryPath } from '../../shared/events'
import { filePaths } from '../../shared/files'
import { retryMessagePath, sessionPaths } from '../../shared/sessions'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { record, text } from '../api/json'
import { now, textOf } from '../components/render-kit'
import { SessionChat } from '../components/SessionChat'
import {
  askedText,
  isSend,
  LINKED,
  linkedRecord,
  loginGone,
  memberChat,
  pendingIn,
  streamLinked,
  type MemberChat,
} from './linked-kit'
import { chatFor, opensSession, shown } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const first = FAKE_IDS.session
const words = askedText
const shortly = { timeout: 10_000 }

type Chat = MemberChat

const snapshot = (chat: Chat) => chat.controller.getSnapshot()

async function sendThatWaits(chat: Chat) {
  await chat.controller.start()
  chat.controller.setDraft(first, words)
  const sending = chat.controller.send(first)
  await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
  return async () => {
    chat.held.splice(0, 1)[0]()
    await sending
  }
}

describe('a reply that names a linked session', () => {
  it('shows the linked session and its message once when the reply comes before the stream', async () => {
    const chat = memberChat()
    await chat.controller.start()
    chat.controller.setDraft(first, words)
    await chat.controller.send(first)
    expect(snapshot(chat).activeSessionId).toBe(LINKED)
    expect(pendingIn(chat, LINKED)).toEqual([words])
    expect(pendingIn(chat, first)).toEqual([])
    expect(chat.draftOf(first)?.text).toBe('')
    expect(chat.histories(LINKED)).toBe(1)
    streamLinked(chat)
    expect(shown(chat.controller, LINKED)).toEqual([`user: ${words}`])
    expect(pendingIn(chat, LINKED)).toEqual([])
  })

  it('keeps a newer stream record, and moves the focus at the reply, when the stream comes first', async () => {
    const chat = memberChat({ hold: isSend })
    const reply = await sendThatWaits(chat)
    streamLinked(chat, { title: 'Loading state' })
    expect(snapshot(chat).activeSessionId).toBe(first)
    await reply()
    const linked = snapshot(chat).sessions.find((item) => item.id === LINKED)
    expect(linked?.title).toBe('Loading state')
    expect(snapshot(chat).activeSessionId).toBe(LINKED)
    expect(shown(chat.controller, LINKED)).toEqual([`user: ${words}`])
    expect(pendingIn(chat, LINKED)).toEqual([])
  })

  it('leaves the shown tab and the new text where the user put them during the send', async () => {
    const chat = memberChat({ hold: isSend })
    const reply = await sendThatWaits(chat)
    await chat.controller.select('debounce')
    chat.controller.setDraft(first, 'Also the error state.')
    await reply()
    expect(snapshot(chat).activeSessionId).toBe('debounce')
    expect(snapshot(chat).sessions.map((item) => item.id)).toContain(LINKED)
    expect(pendingIn(chat, LINKED)).toEqual([words])
    expect(chat.draftOf(first)?.text).toBe('Also the error state.')
  })

  it('sends again with the same ID after a lost reply, and keeps one linked session and one message', async () => {
    let sends = 0
    const chat = memberChat({
      wrap: (opens) => async (request) => {
        if (!isSend(request)) return opens(request)
        sends += 1
        if (sends > 1) return opens(request)
        const error = { code: 'internal_error', message: 'Try again.' }
        return Response.json({ error }, { status: 500 })
      },
    })
    await chat.controller.start()
    chat.controller.setDraft(first, words)
    await chat.controller.send(first)
    expect(snapshot(chat).notice?.title).toBe("Your message didn't send")
    // The Worker took the message before its reply got lost.
    streamLinked(chat)
    await chat.controller.send(first)
    const bodies = await chat.bodies(
      'POST',
      sessionPaths.messages(org, ws, first),
    )
    expect(bodies.map((body) => text(record(body).id))).toEqual([
      'client-1',
      'client-1',
    ])
    expect(snapshot(chat).activeSessionId).toBe(LINKED)
    const linked = snapshot(chat).sessions.filter(
      (item) => item.sourceSessionId === first,
    )
    expect(linked.map((item) => item.id)).toEqual([LINKED])
    expect(shown(chat.controller, LINKED)).toEqual([`user: ${words}`])
    expect(pendingIn(chat, LINKED)).toEqual([])
    expect(chat.draftOf(first)?.text).toBe('')
  })

  it('opens the linked session from the reply of Try again', async () => {
    const chat = memberChat({
      conversation: 'failed',
      change: (session) => ({ ...loginGone(session), retryMessageId: 'ask' }),
    })
    await chat.controller.start()
    await chat.controller.retry(first, 'ask')
    expect(
      chat.requests('POST', retryMessagePath(org, ws, first, 'ask')),
    ).toHaveLength(1)
    expect(snapshot(chat).activeSessionId).toBe(LINKED)
    expect(pendingIn(chat, LINKED)).toEqual([workspaceFixtures().message.text])
  })

  it('shows the linked session to another reader in another tab, without moving the focus of that tab', async () => {
    const sender = memberChat()
    const other = chatFor({
      conversation: 'history',
      stream: sender.server.events,
    })
    other.server.json('GET', chatHistoryPath(org, ws, LINKED), {
      events: [],
      throughEventNumber: 0,
    })
    await sender.controller.start()
    await other.controller.start()
    other.controller.setDraft(first, 'Cal types here.')
    sender.controller.setDraft(first, words)
    await sender.controller.send(first)
    streamLinked(sender)
    expect(snapshot(sender).activeSessionId).toBe(LINKED)
    expect(snapshot(other).activeSessionId).toBe(first)
    expect(snapshot(other).sessions.map((item) => item.id)).toContain(LINKED)
    expect(other.draftOf(first)?.text).toBe('Cal types here.')
    expect(shown(other.controller, LINKED)).toEqual([`user: ${words}`])
    await other.controller.select(LINKED)
    const markup = renderToStaticMarkup(
      <SessionChat
        controller={other.controller}
        mobile={false}
        now={now}
        snapshot={snapshot(other)}
      />,
    )
    expect(textOf(markup)).toContain("Priya Raman's login")
  })
})

const codex: AgentChoice = {
  agent: 'codex',
  model: 'GPT-6.1 Sol',
  effort: 'medium',
  fast: false,
}
const isUpload = (request: Request) =>
  request.method === 'POST' &&
  new URL(request.url).pathname === filePaths.attachments(org, ws)
const isRetry = (request: Request) =>
  request.method === 'POST' && request.url.endsWith('/retry')

/** Starts an upload that waits until the test lets it go. */
function attachThatWaits(chat: Chat) {
  chat.server.json(
    'POST',
    filePaths.attachments(org, ws),
    {
      attachment: {
        id: 'late-file',
        name: 'late-file.png',
        kind: 'image',
        mediaType: 'image/png',
        sizeBytes: 3,
      },
    },
    201,
  )
  const file = new File(['png'], 'late-file.png', { type: 'image/png' })
  return pickChatFiles(chat, first, [file])
}

describe('the draft when a reply opens a linked session', () => {
  it('moves the draft with the view, with its identity, its new text, and its upload in flight', async () => {
    const chat = memberChat({
      hold: (request) => isSend(request) || isUpload(request),
    })
    const reply = await sendThatWaits(chat)
    const draftId = chat.draftOf(first)?.id
    chat.controller.setDraft(first, 'Also the error state.')
    const attaching = attachThatWaits(chat)
    await vi.waitFor(() => expect(chat.held).toHaveLength(2), shortly)
    await reply()
    expect(snapshot(chat).activeSessionId).toBe(LINKED)
    expect(chat.draftOf(LINKED)?.id).toBe(draftId)
    expect(chat.draftOf(LINKED)?.text).toBe(
      `Also the error state. ${fileMark('file-1')} `,
    )
    expect(chat.draftOf(LINKED)?.files.map((item) => item.state)).toEqual([
      'uploading',
    ])
    expect(chat.draftOf(first)?.id).not.toBe(draftId)
    expect(chat.draftOf(first)?.text).toBe('')
    chat.held.splice(0, 1)[0]()
    await attaching
    const files = (sessionId: string) =>
      readyIds(chat.draftOf(sessionId)?.files ?? [])
    expect(files(LINKED)).toEqual(['late-file'])
    expect(files(first)).toEqual([])
    expect(pendingIn(chat, LINKED)).toEqual([words])
  })

  it('keeps the draft and the shown session while another send of the draft still waits', async () => {
    const chat = memberChat({
      conversation: 'failed',
      change: (session) => ({ ...loginGone(session), retryMessageId: 'ask' }),
      hold: (request) => isSend(request) || isRetry(request),
    })
    await chat.controller.start()
    const retrying = chat.controller.retry(first, 'ask')
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    chat.controller.setDraft(first, words)
    const sending = chat.controller.send(first)
    await vi.waitFor(() => expect(chat.held).toHaveLength(2), shortly)
    chat.held.splice(0, 1)[0]()
    await retrying
    expect(snapshot(chat).activeSessionId).toBe(first)
    expect(chat.draftOf(first)?.text).toBe('')
    expect(chat.draftOf(first)?.sending).toBe(true)
    expect(pendingIn(chat, first)).toEqual([words])
    expect(snapshot(chat).sessions.map((item) => item.id)).toContain(LINKED)
    chat.held.splice(0, 1)[0]()
    await sending
    expect(snapshot(chat).activeSessionId).toBe(LINKED)
    expect(pendingIn(chat, first)).toEqual([])
    expect(pendingIn(chat, LINKED).at(-1)).toBe(words)
  })

  it('keeps both drafts, and the source shown, when the linked session already holds unfinished work', async () => {
    const chat = memberChat({ hold: isSend })
    const reply = await sendThatWaits(chat)
    chat.emit({ type: 'session.updated', session: linkedRecord() })
    await chat.controller.select(LINKED)
    chat.controller.setDraft(LINKED, 'Notes for the new session.')
    await chat.controller.select(first)
    chat.controller.setDraft(first, 'Also the error state.')
    await reply()
    expect(snapshot(chat).activeSessionId).toBe(first)
    expect(chat.draftOf(first)?.text).toBe('Also the error state.')
    expect(chat.draftOf(LINKED)?.text).toBe('Notes for the new session.')
  })

  it('keeps a newer draft in the source when a model change already moved the draft of the request', async () => {
    const chat = memberChat({
      hold: isSend,
      wrap: (opens) => async (request) =>
        (await opensSession(codex)(request)) ?? opens(request),
    })
    const reply = await sendThatWaits(chat)
    const draftId = chat.draftOf(first)?.id
    await chat.controller.chooseModel(first, codex)
    // The model change took the client ID after the one of the send.
    expect(chat.draftOf('client-2')?.id).toBe(draftId)
    await chat.controller.select(first)
    chat.controller.setDraft(first, 'A newer message.')
    await reply()
    expect(snapshot(chat).activeSessionId).toBe(first)
    expect(chat.draftOf(first)?.text).toBe('A newer message.')
    expect(chat.draftOf(LINKED)?.text ?? '').toBe('')
  })
})
