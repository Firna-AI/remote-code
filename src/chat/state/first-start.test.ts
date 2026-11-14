import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import { describe, expect, it } from 'vitest'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import { fileMark } from '../../app/draft-marks'
import { pickChatFiles } from './draft-files.test-support'
import { sessionPaths } from '../../shared/sessions'
import { workspacePath, type WorkspaceResponse } from '../../shared/workspaces'
import type { RecordedChatScenario } from '../../test-support/recorded-chat'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { record, text } from '../api/json'
import { chatFor } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const first = FAKE_IDS.session
const second = 'debounce'
const messagesOf = (sessionId: string) =>
  sessionPaths.messages(org, ws, sessionId)

const workspaceIn = (state: WorkspaceState) => ({
  ...workspaceFixtures().detail.workspace,
  state,
})

/** A first start that failed: its create start shows a failed step. */
const failedCreateStart: WorkspaceStart = {
  kind: 'create',
  startedAt: FAKE_TIME,
  steps: [
    {
      id: 'image',
      label: 'Starting from the cloud computer of Acme',
      state: 'failed',
      startedAt: FAKE_TIME,
      completedAt: FAKE_TIME,
    },
  ],
}

const limit =
  'The cloud computer did not start within the 20-minute limit. Try again.'
const notStarted = 'The cloud computer could not start. Try again.'

/**
 * A chat whose load reads this workspace record, start, and saved error,
 * before the events that the test sends.
 */
function chatWith(
  detail: WorkspaceResponse,
  conversation: RecordedChatScenario,
) {
  const chat = chatFor({ conversation })
  chat.server.json('GET', workspacePath(org, ws), {
    ...detail,
    eventNumber: 0,
  })
  return chat
}

const sentTexts = async (chat: ReturnType<typeof chatFor>, id: string) =>
  (await chat.bodies('POST', messagesOf(id))).map((body) =>
    text(record(body).text),
  )

describe('messages while the sandbox of a workspace is not ready', () => {
  it('sends each message during the first start, after it failed, and during a resume, so the workspace queues it', async () => {
    // Just after the create, the record of the start has not come yet.
    const chat = chatWith(
      { workspace: workspaceIn('starting'), start: null, error: null },
      'queued',
    )
    await chat.controller.start()
    chat.controller.setDraft(first, 'Keep a saved cart for 30 days.')
    await chat.controller.send(first)
    chat.emit({ type: 'workspace.updated', workspace: workspaceIn('error') })
    chat.emit({ type: 'start.updated', start: failedCreateStart })
    chat.controller.setDraft(second, 'Add an index on the user ID.')
    await chat.controller.send(second)
    chat.emit({ type: 'workspace.updated', workspace: workspaceIn('starting') })
    chat.controller.setDraft(first, 'Run the unit tests again.')
    await chat.controller.send(first)

    expect(await sentTexts(chat, first)).toEqual([
      'Keep a saved cart for 30 days.',
      'Run the unit tests again.',
    ])
    expect(await sentTexts(chat, second)).toEqual([
      'Add an index on the user ID.',
    ])
  })

  it('keeps the message that the workspace saved for a failed start, from a read or the stream, until an update clears it', async () => {
    const chat = chatWith(
      {
        workspace: workspaceIn('error'),
        start: failedCreateStart,
        error: {
          code: 'workspace_start_failed',
          message: notStarted,
          log: null,
        },
      },
      'queued',
    )
    await chat.controller.start()
    chat.controller.setDraft(first, 'Keep these newer cart changes.')
    await pickChatFiles(chat, first, [
      new File(['Cart notes'], 'notes.txt', { type: 'text/plain' }),
    ])
    const draft = chat.draftOf(first)
    expect(draft).toMatchObject({
      text: `Keep these newer cart changes. ${fileMark('file-1')} `,
      files: [{ state: 'ready', attachment: { id: 'attachment-1' } }],
    })
    const savedError = () => chat.controller.getSnapshot().savedError
    const read = savedError()
    chat.emit({
      type: 'workspace.updated',
      workspace: workspaceIn('error'),
      error: { code: 'workspace_start_failed', message: limit },
    })
    const streamed = savedError()
    // An update without an error keeps the saved one.
    chat.emit({ type: 'workspace.updated', workspace: workspaceIn('error') })
    const kept = savedError()
    chat.emit({
      type: 'workspace.updated',
      workspace: workspaceIn('starting'),
      error: null,
    })

    expect({ read, streamed, kept, cleared: savedError() }).toEqual({
      read: notStarted,
      streamed: limit,
      kept: limit,
      cleared: null,
    })
    expect(chat.draftOf(first)).toEqual(draft)
  })

  it('keeps the text, the file, and the ID of a message that the Worker refuses', async () => {
    const refusal = {
      error: {
        code: 'session_closed',
        message: 'Reopen the session to send a message.',
      },
    }
    let sends = 0
    const chat = chatFor({
      conversation: 'queued',
      answer: async (request) => {
        if (request.method !== 'POST' || !request.url.endsWith('/messages')) {
          return null
        }
        sends += 1
        return sends === 1 ? Response.json(refusal, { status: 409 }) : null
      },
    })
    await chat.controller.start()
    chat.controller.setDraft(first, 'Keep a saved cart for 30 days.')
    await pickChatFiles(chat, first, [
      new File(['png'], 'cart.png', { type: 'image/png' }),
    ])
    await chat.controller.send(first)
    expect(chat.draftOf(first)).toMatchObject({
      text: `Keep a saved cart for 30 days. ${fileMark('file-1')} `,
      files: [{ state: 'ready', attachment: { id: 'attachment-1' } }],
      sending: false,
    })
    expect(chat.controller.getSnapshot().notice).toEqual({
      sessionId: first,
      title: "Your message didn't send",
      message: 'Reopen the session to send a message.',
    })

    await chat.controller.send(first)
    const bodies = await chat.bodies('POST', messagesOf(first))
    expect(bodies.map((body) => text(record(body).id))).toEqual([
      'client-1',
      'client-1',
    ])
    expect(chat.draftOf(first)?.text).toBe('')
  })
})
