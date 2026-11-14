import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { pickChatFiles } from './draft-files.test-support'
import { readyIds } from '../../app/draft-files'
import { fileMark } from '../../app/draft-marks'
import { filePaths } from '../../shared/files'
import { sessionPaths } from '../../shared/sessions'
import type { WorkspaceTab, WorkspaceView } from '../../shared/workspace-view'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { chatFor, newSessionRecord, opensSession } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const id = FAKE_IDS.session
const codex: AgentChoice = {
  agent: 'codex',
  model: 'GPT-6.1 Sol',
  effort: 'medium',
  fast: false,
}
/** The ID of the new session: the first client ID that the chat takes. */
const created = 'client-1'
const initialText = `Check the postcode rules. ${fileMark('file-1')} ${fileMark('file-2')} `
const keptText = `Check the postcode rules. ${fileMark('file-1')}  `

/**
 * The view that the user chose, with the place of the new session at the
 * end of the saved order, as every open session gets one. The selection
 * stays.
 */
const withCreatedPlace = (view: WorkspaceView | null) =>
  view && {
    ...view,
    tabs: [...view.tabs, { kind: 'session', sessionId: created }],
  }
const shortly = { timeout: 10_000 }
const isModel = (request: Request) =>
  request.method === 'PUT' && request.url.endsWith('/model')

type Chat = ReturnType<typeof chatFor>

async function attach(chat: Chat, sessionId: string, fileId: string) {
  chat.server.json(
    'POST',
    filePaths.attachments(org, ws),
    {
      attachment: {
        id: fileId,
        name: `${fileId}.png`,
        kind: 'image',
        mediaType: 'image/png',
        sizeBytes: 3,
      },
    },
    201,
  )
  const file = new File(['png'], `${fileId}.png`, { type: 'image/png' })
  await pickChatFiles(chat, sessionId, [file])
}

/** The user types at the end of the text that the composer of a session shows. */
function type(chat: Chat, sessionId: string, words: string) {
  const shown = chat.draftOf(sessionId)?.text ?? ''
  chat.controller.setDraft(
    sessionId,
    shown === '' || /\s$/.test(shown)
      ? `${shown}${words}`
      : `${shown} ${words}`,
  )
}

const files = (chat: Chat, sessionId: string) =>
  readyIds(chat.draftOf(sessionId)?.files ?? [])

/**
 * A chat whose draft has a file that the backend keeps and one that it drops.
 * Its pick of a Codex model waits until the test lets the reply go. The test
 * records the draft of the new session in the first snapshot that shows it.
 */
async function pickThatWaits() {
  const chat = chatFor({
    conversation: 'history',
    hold: isModel,
    answer: opensSession(codex, (file) => file === 'kept-file'),
  })
  await chat.controller.start()
  chat.controller.setDraft(id, 'Check the postcode rules.')
  await attach(chat, id, 'kept-file')
  await attach(chat, id, 'dropped-file')
  const firstShown: (string | null)[] = []
  chat.controller.subscribe(() => {
    const snapshot = chat.controller.getSnapshot()
    const known = [...snapshot.sessions, ...snapshot.history]
    if (firstShown.length > 0 || !known.some((item) => item.id === created)) {
      return
    }
    firstShown.push(snapshot.sessionStates[created]?.draft.text ?? null)
  })
  const picking = chat.controller.chooseModel(id, codex)
  await vi.waitFor(() => expect(chat.held).toHaveLength(1), shortly)
  const reply = async () => {
    chat.held.splice(0, 1)[0]()
    await picking
  }
  return { chat, firstShown, reply }
}

describe('a model change that opens a session', () => {
  it('keeps a file tab selected when a model reply moves the last shown session draft', async () => {
    const { chat, reply } = await pickThatWaits()
    const file: WorkspaceTab = {
      kind: 'file',
      path: 'src/checkout.ts',
      mode: 'source',
    }
    chat.controller.updateView((view) => ({
      ...view,
      tabs: [...view.tabs, file],
      activeTab: file,
    }))
    const selectedView = chat.controller.getSnapshot().view
    await reply()
    const snapshot = chat.controller.getSnapshot()
    expect(snapshot.view).toEqual(withCreatedPlace(selectedView))
    expect(snapshot.activeSessionId).toBe(id)
    expect(chat.draftOf(created)?.text).toBe(keptText)
    expect(chat.draftOf(id)?.text).toBe('')
    expect(chat.histories(created)).toBe(0)
  })

  it.each(['reply', 'stream'] as const)(
    'keeps a newer tab selection when the %s first shows the new session',
    async (first) => {
      const { chat, firstShown, reply } = await pickThatWaits()
      const draftId = chat.draftOf(id)?.id
      await chat.controller.select('debounce')
      chat.controller.setDraft('debounce', 'Finish the lookup tests.')
      const selectedView = chat.controller.getSnapshot().view
      const showRecord = () =>
        chat.emit({
          type: 'session.updated',
          session: newSessionRecord(created, codex),
        })
      if (first === 'stream') {
        showRecord()
      } else {
        await reply()
      }
      expect(chat.controller.getSnapshot().activeSessionId).toBe('debounce')
      if (first === 'stream') await reply()
      else showRecord()
      const snapshot = chat.controller.getSnapshot()
      expect(snapshot.activeSessionId).toBe('debounce')
      expect(snapshot.view).toEqual(withCreatedPlace(selectedView))
      expect(chat.draftOf('debounce')?.text).toBe('Finish the lookup tests.')
      expect(chat.draftOf(created)).toMatchObject({
        id: draftId,
        text: keptText,
      })
      expect(files(chat, created)).toEqual(['kept-file'])
      expect(chat.draftOf(id)?.text).toBe('')
      expect(firstShown).toEqual([initialText])
      expect(chat.histories(created)).toBe(0)
    },
  )

  it('keeps both drafts when the stream shows the new session before the reply', async () => {
    const { chat, firstShown, reply } = await pickThatWaits()
    chat.emit({
      type: 'session.updated',
      session: newSessionRecord(created, codex),
    })
    await chat.controller.select(created)
    type(chat, created, 'Also check Irish postcodes.')
    await attach(chat, created, 'late-file')
    await reply()
    expect(chat.draftOf(created)?.text).toBe(
      `${keptText}Also check Irish postcodes. ${fileMark('file-3')} `,
    )
    expect(files(chat, created)).toEqual(['kept-file', 'late-file'])
    expect(chat.draftOf(id)?.text).toBe('')
    expect(files(chat, id)).toEqual([])
    expect(firstShown).toEqual([initialText])
    expect(chat.controller.getSnapshot().activeSessionId).toBe(created)
    expect(await chat.bodies('PUT', sessionPaths.model(org, ws, id))).toEqual([
      {
        choice: codex,
        draft: {
          text: initialText,
          attachmentIds: ['kept-file', 'dropped-file'],
        },
        newSessionId: created,
      },
    ])
  })

  it('moves the draft once when the reply comes before the stream record', async () => {
    const { chat, firstShown, reply } = await pickThatWaits()
    await reply()
    expect(firstShown).toEqual([initialText])
    expect(files(chat, created)).toEqual(['kept-file'])
    await chat.controller.select(id)
    type(chat, id, 'Next, the shipping form.')
    chat.emit({
      type: 'session.updated',
      session: newSessionRecord(created, codex),
    })
    expect(chat.draftOf(id)?.text).toBe('Next, the shipping form.')
    expect(chat.draftOf(created)?.text).toBe(keptText)
    expect(chat.controller.getSnapshot().activeSessionId).toBe(id)
  })

  it('keeps the moved draft in the closed session when it closes before the reply', async () => {
    const { chat, reply } = await pickThatWaits()
    chat.emit({
      type: 'session.updated',
      session: newSessionRecord(created, codex),
    })
    chat.emit({
      type: 'session.updated',
      session: newSessionRecord(created, codex, 1),
    })
    await chat.controller.select(id)
    type(chat, id, 'Next, the shipping form.')
    await reply()
    const snapshot = chat.controller.getSnapshot()
    expect(snapshot.history.map((item) => item.id)).toContain(created)
    expect(snapshot.sessions.map((item) => item.id)).not.toContain(created)
    expect(chat.draftOf(created)?.text).toBe(keptText)
    expect(files(chat, created)).toEqual(['kept-file'])
    expect(chat.draftOf(id)?.text).toBe('Next, the shipping form.')
  })
})
