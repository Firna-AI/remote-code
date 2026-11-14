import type { Session } from '../../shared/generated/Session'
// @vitest-environment happy-dom

import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { AppModel } from '../../app/app-model'
import { routes } from '../../app/router'
import type { AppServices, Platform } from '../../app/services'
import { requestLines } from '../../app/test-kit'
import {
  sessionPaths,
  sessionsPath,
  sessionTranscriptPath,
} from '../../shared/sessions'
import type { FilesTab } from '../../files/navigation'
import type { ShortcutCommandId } from '../../shared/shortcut-commands'
import {
  accessibleName,
  byLabel,
  byRole,
  queryByRole,
  shownToasts,
} from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { FAKE_FILE_PATH } from '../../test-support/fixtures/tools'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import {
  holdAnimationFrames,
  MOUNTED_TEST_TIMEOUT,
} from '../../test-support/mount'
import { openPaletteTab } from '../palette/palette-test-kit'
import {
  pressHintKey,
  serveShortcutChanges,
} from '../shortcuts/shortcut-test-kit'
import { click, press as pressKey, settle } from '../test-mount'
import { filesHref } from './files/files-address'
import { bodiesOf, lastEvent, messageField } from './kept-test-kit'
import { socketsOf } from './wiring-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { org, workspace: id, session } = FAKE_IDS
const [autocomplete, debounce] = workspaceFixtures().sessions.sessions
const fileTab: FilesTab = {
  kind: 'file',
  path: FAKE_FILE_PATH,
  mode: 'preview',
}
const fileName = 'AddressForm.tsx'

/**
 * The open workspace in a Chrome tab on Windows, or on a Mac with
 * `platform`, over `server`, with the clipboard `copy` of the test, if any.
 */
async function openWorkspace(
  server: FakeApiServer,
  options: { copy?: AppServices['copy']; platform?: Platform } = {},
) {
  holdAnimationFrames()
  const opened = await openPaletteTab(routes.workspace(org, id), {
    server,
    events: socketsOf(server).events,
    copy: options.copy,
    platform: options.platform,
  })
  await settle()
  const press = async (command: ShortcutCommandId) => {
    pressHintKey(opened.app, command)
    await settle()
  }
  return { ...opened, press }
}

/** Presses the key of Fast mode on the page, and says whether it ran a command. */
async function pressFast(app: AppModel): Promise<boolean> {
  const key = pressHintKey(app, 'fast-mode', document.body)
  await settle()
  return key.defaultPrevented
}

describe('the keys of the workspace', () => {
  test('the tab row steps through its tabs with a wrap, closes the shown tab, and reopens the session that closed last', async () => {
    const server = new FakeApiServer()
    // The server closes the session, then reopens it, after the events of
    // the recorded chat.
    server.json('POST', sessionPaths.close(org, id, debounce.id), {
      session: { ...debounce, closedAt: FAKE_TIME },
      eventNumber: lastEvent(server) + 1,
    })
    server.json('POST', sessionPaths.reopen(org, id, debounce.id), {
      session: debounce,
      eventNumber: lastEvent(server) + 2,
    })
    const { view, navigation, press } = await openWorkspace(server)
    // A file opens as the third tab of the row, after the two sessions.
    act(() => navigation.push(filesHref(org, id, fileTab)))
    await settle()
    const row = byLabel('Sessions and files', view)
    const shown = () => row.querySelector('[aria-current="page"]')?.textContent
    const titles = () => Array.from(row.querySelectorAll('li'), accessibleName)
    const steps: (string | undefined)[] = []
    for (const command of ['next-tab', 'previous-tab'] as const) {
      await press(command)
      steps.push(shown())
    }
    await press('close-tab')
    const fileClosed = titles()
    await press('next-tab')
    steps.push(shown())
    await press('close-tab')
    const sessionClosed = titles()
    await press('reopen-session')
    expect({
      steps,
      fileClosed,
      sessionClosed,
      reopened: titles(),
    }).toEqual({
      steps: [autocomplete.title, fileName, debounce.title],
      fileClosed: [autocomplete.title, debounce.title],
      sessionClosed: [autocomplete.title],
      reopened: [autocomplete.title, debounce.title],
    })
  })

  test('the composer focuses its message field, attaches files, opens the model picker, chooses the next effort with a wrap, and stops the agent', async () => {
    const server = new FakeApiServer({ conversation: 'running' })
    // The session starts on Ultra, the last effort of Opus 5.5.
    const sessions = workspaceFixtures().sessions
    const onUltra: Session = {
      ...autocomplete,
      choice: { ...autocomplete.choice, effort: 'ultra' },
    }
    server.json('GET', sessionsPath(org, id), {
      ...sessions,
      sessions: [onUltra, debounce],
    })
    const { view, press } = await openWorkspace(server)
    const field = messageField(view)
    let picks = 0
    view
      .querySelector('input[type="file"]')
      ?.addEventListener('click', () => (picks += 1))
    await press('focus-message')
    const focused = document.activeElement === field
    await press('attach-files')
    await press('model-picker')
    const menu = queryByRole('menu', 'Model and effort') !== null
    await press('next-effort')
    await press('stop-agent')
    const interrupt = `POST ${sessionPaths.interrupt(org, id, session)}`
    expect({
      focused,
      picks,
      menu,
      changes: await bodiesOf(
        server,
        'PUT',
        sessionPaths.model(org, id, session),
        0,
      ),
      stops: requestLines(server).filter((line) => line === interrupt).length,
    }).toEqual({
      focused: true,
      picks: 1,
      menu: true,
      changes: [
        expect.objectContaining({
          choice: {
            agent: 'claude',
            model: 'Opus 5.5',
            effort: 'low',
            fast: false,
          },
        }),
      ],
      stops: 1,
    })
  })

  test('the copy keys copy the transcript of the session of the shown tab with its toast, as its tab menu does, and do nothing while a file shows', async () => {
    const server = new FakeApiServer()
    // The person recorded a key for Copy full transcript, which has none.
    serveShortcutChanges(server, 'other', [
      { command: 'copy-full-transcript', keys: ['Alt+Shift+K'] },
    ])
    const markdown = {
      concise: '# Address autocomplete\n\n_3 tool calls_\n',
      full: '# Address autocomplete\n\n- Read `src/lookup.ts`\n',
    } as const
    for (const detail of ['concise', 'full'] as const) {
      const path = sessionTranscriptPath(org, id, session, detail)
      server.json('GET', path, { markdown: markdown[detail] })
    }
    const copied: string[] = []
    const { app, navigation } = await openWorkspace(server, {
      copy: async (text) => {
        copied.push(await text)
      },
    })
    const press = async (command: ShortcutCommandId) => {
      const key = pressHintKey(app, command, document.body)
      await settle()
      return key.defaultPrevented
    }

    const concise = await press('copy-concise-transcript')
    const toasts = shownToasts().map((toast) => toast.textContent)
    const full = await press('copy-full-transcript')
    act(() => navigation.push(filesHref(org, id, fileTab)))
    await settle()
    const onFile = await press('copy-concise-transcript')

    expect({ concise, full, onFile, copied, toasts }).toEqual({
      concise: true,
      full: true,
      onFile: false,
      copied: [markdown.concise, markdown.full],
      toasts: ['Transcript copied'],
    })
  })

  test('the key of Fast mode shows at the end of the Fast row of the session, and turns fast mode on for the shown session', async () => {
    const server = new FakeApiServer()
    const { app, view } = await openWorkspace(server, { platform: 'mac' })
    click(byRole('button', 'Model and effort: Opus 5.5, High', view))
    const row = byRole('menuitemcheckbox', 'Fast')
    const shown = {
      keys: row.querySelector('kbd')?.textContent,
      name: row.getAttribute('aria-keyshortcuts'),
    }
    pressKey(row, 'Escape')
    const ran = await pressFast(app)
    const model = sessionPaths.model(org, id, session)
    expect({
      shown,
      ran,
      changes: await bodiesOf(server, 'PUT', model, 0),
    }).toEqual({
      shown: { keys: '⇧⌘E', name: 'Shift+Meta+E' },
      ran: true,
      changes: [
        expect.objectContaining({
          choice: {
            agent: 'claude',
            model: 'Opus 5.5',
            effort: 'high',
            fast: true,
          },
        }),
      ],
    })
  })

  test('the key of Fast mode does nothing for a model without fast mode, and goes on to the page', async () => {
    const server = new FakeApiServer()
    // The shown session runs Sonnet 5.5, which has no fast mode.
    const onSonnet: Session = {
      ...autocomplete,
      choice: { ...autocomplete.choice, model: 'Sonnet 5.5' },
    }
    server.json('GET', sessionsPath(org, id), {
      ...workspaceFixtures().sessions,
      sessions: [onSonnet, debounce],
    })
    const { app } = await openWorkspace(server, { platform: 'mac' })
    const model = sessionPaths.model(org, id, session)
    expect({
      ran: await pressFast(app),
      changes: await bodiesOf(server, 'PUT', model, 0),
    }).toEqual({ ran: false, changes: [] })
  })
})
