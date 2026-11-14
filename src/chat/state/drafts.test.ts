import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { fileMark } from '../../app/draft-marks'
import { pickChatFiles } from './draft-files.test-support'
import { readyIds } from '../../app/draft-files'
import { filePaths } from '../../shared/files'
import { sessionPaths } from '../../shared/sessions'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { record, text } from '../api/json'
import { chatFor, opensSession } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const id = FAKE_IDS.session
const codex: AgentChoice = {
  agent: 'codex',
  model: 'GPT-6.1 Sol',
  effort: 'medium',
  fast: false,
}
const shortly = { timeout: 10_000 }
const file = () => new File(['png'], 'overlap.png', { type: 'image/png' })
const isUpload = (request: Request) =>
  request.method === 'POST' &&
  new URL(request.url).pathname === filePaths.attachments(org, ws)
const isSend = (request: Request) =>
  request.method === 'POST' && request.url.endsWith('/messages')

/** A chat whose next pick of a Codex model opens a session, as the backend does. */
async function chatWithCodex(hold: (request: Request) => boolean) {
  const chat = chatFor({
    conversation: 'history',
    hold,
    answer: opensSession(codex),
  })
  await chat.controller.start()
  return chat
}

/** The ID that the request of the Codex pick chose for its new session. */
async function opened(chat: ReturnType<typeof chatFor>): Promise<string> {
  const [body] = await chat.bodies('PUT', sessionPaths.model(org, ws, id))
  return text(record(body).newSessionId)
}

describe('a draft that moves to another session', () => {
  it('takes a file that still uploads, and Send waits for it in the new session', async () => {
    const chat = await chatWithCodex(isUpload)
    chat.controller.setDraft(id, 'See the screenshot.')
    const uploading = pickChatFiles(chat, id, [file()])
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    await chat.controller.chooseModel(id, codex)
    const created = await opened(chat)
    expect(chat.controller.getSnapshot().activeSessionId).toBe(created)
    await chat.controller.send(created)
    const messages = sessionPaths.messages(org, ws, created)
    expect(chat.requests('POST', messages)).toHaveLength(0)
    chat.held.splice(0, 1)[0]()
    await uploading
    expect(readyIds(chat.draftOf(created)?.files ?? [])).toEqual([
      'attachment-1',
    ])
    expect(chat.draftOf(id)?.files).toEqual([])
    chat.server.json(
      'POST',
      messages,
      {
        message: {
          id: 'client-2',
          sessionId: created,
          sender: {
            id: 'cal',
            githubLogin: 'calummoore',
            displayName: 'Cal',
            avatarUrl: null,
          },
          text: 'See the screenshot.',
          attachments: [],
          choice: codex,
          createdAt: FAKE_TIME,
          state: 'sent',
        },
        turnId: 'turn-2',
      },
      202,
    )
    await chat.controller.send(created)
    expect(await chat.bodies('POST', messages)).toMatchObject([
      { attachmentIds: ['attachment-1'] },
    ])
  })

  it('shows a moved upload that fails as a failed file in the session that holds the draft', async () => {
    const chat = await chatWithCodex(isUpload)
    chat.controller.setDraft(id, 'See the screenshot.')
    const uploading = pickChatFiles(chat, id, [file()])
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    await chat.controller.chooseModel(id, codex)
    const created = await opened(chat)
    chat.server.json(
      'POST',
      filePaths.attachments(org, ws),
      { error: { code: 'file_too_large', message: 'The file is too large.' } },
      413,
    )
    chat.held.splice(0, 1)[0]()
    await uploading
    expect({
      moved: chat
        .draftOf(created)
        ?.files.map((item) =>
          item.state === 'failed'
            ? `${item.file.name}: ${item.error.message}`
            : item.state,
        ),
      left: chat.draftOf(id)?.files,
      notice: chat.controller.getSnapshot().notice,
    }).toEqual({
      moved: ['overlap.png: The file is too large.'],
      left: [],
      notice: null,
    })
  })

  it('keeps the text that the user types after a send, when the send ends after the draft moved', async () => {
    const chat = await chatWithCodex(isSend)
    chat.controller.setDraft(id, 'See the screenshot.')
    const sending = chat.controller.send(id)
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    expect(chat.draftOf(id)?.text).toBe('')
    await chat.controller.chooseModel(id, codex)
    const created = await opened(chat)
    chat.controller.setDraft(created, 'And the empty state.')
    chat.held.splice(0, 1)[0]()
    await sending
    expect(chat.draftOf(created)).toMatchObject({
      text: 'And the empty state.',
      sending: false,
    })
    expect(chat.draftOf(id)?.text).toBe('')
  })

  it('keeps a file that the user picks while a send waits, after the sent text cleared', async () => {
    const chat = chatFor({ conversation: 'history', hold: isSend })
    await chat.controller.start()
    chat.controller.setDraft(id, 'Check the postcode rules.')
    const sending = chat.controller.send(id)
    await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
    await pickChatFiles(chat, id, [file()])
    chat.held.splice(0, 1)[0]()
    await sending
    expect(chat.draftOf(id)?.text).toBe(`${fileMark('file-1')} `)
    expect(readyIds(chat.draftOf(id)?.files ?? [])).toEqual(['attachment-1'])
  })
})
