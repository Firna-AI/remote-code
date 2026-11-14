// @vitest-environment happy-dom

import { describe, expect, test, vi } from 'vitest'
import type { UserMessage } from '../../shared/generated/UserMessage'
import { memoryNavigation, NavigationContext } from '../../app/navigation'
import {
  accessibleName,
  byRole,
  queryByLabel,
} from '../../test-support/dom-queries'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME, fakeUser } from '../../test-support/fixtures/core'
import { FAKE_FILE_PATH } from '../../test-support/fixtures/tools'
import { senderSnapshot } from '../../test-support/fixtures/workspaces'
import { typeMessage } from '../../test-support/message-field'
import {
  holdAnimationFrames,
  MOUNTED_TEST_TIMEOUT,
} from '../../test-support/mount'
import { Shell } from '../Shell'
import { click, mountScreen, settle } from '../test-mount'
import { startedApp } from '../test-render'
import type { Viewport } from '../ui/viewport'
import { filesHref } from './files/files-address'
import { emit, here, org, recordingSocket } from './kept-test-kit'
import { linksTo, linkTo } from './wiring-test-kit'

vi.setConfig({ testTimeout: MOUNTED_TEST_TIMEOUT })

const { workspace: id } = FAKE_IDS
const fileHref = filesHref(org, id, {
  kind: 'file',
  path: FAKE_FILE_PATH,
  mode: 'preview',
})
const allFilesHref = filesHref(org, id, { kind: 'list', list: 'all' })

const message: UserMessage = {
  id: 'mentions',
  sessionId: FAKE_IDS.session,
  sender: senderSnapshot(fakeUser),
  text: `Move @${FAKE_FILE_PATH} into @src/lib/ now.`,
  attachments: [],
  choice: { agent: 'claude', model: 'Opus 5.5', effort: 'high', fast: false },
  createdAt: FAKE_TIME,
  state: 'sent',
}

/** The workspace screen with a sent message that mentions a file and a folder. */
async function openChat(viewport: Viewport) {
  holdAnimationFrames()
  const server = new FakeApiServer()
  const app = await startedApp(server, {
    events: recordingSocket(server).source,
  })
  const navigation = memoryNavigation(here)
  const view = mountScreen(
    app,
    <NavigationContext.Provider value={navigation}>
      <Shell />
    </NavigationContext.Provider>,
    { viewport },
  )
  await settle()
  emit(server, { type: 'message.accepted', message })
  await settle()
  return { view, navigation }
}

/** The chip of the folder `src/lib` in the sent message. */
function folderChip(view: HTMLElement): HTMLElement {
  const chip = linksTo(view, allFilesHref).find(
    (link) => link.title === 'src/lib/',
  )
  if (!chip) throw new Error('The sent message shows no chip of src/lib.')
  return chip
}

/** Whether the folder row of All files is open. */
function folderOpen(view: HTMLElement, name: string): string | null {
  return byRole('button', name, view).getAttribute('aria-expanded')
}

describe('file mentions in the workspace screen', () => {
  test('on a phone, before a visit to Files, the composer lists the files, a sent message shows its chips, and the chips open the file and the folder', async () => {
    const { view, navigation } = await openChat('phone')
    typeMessage(byRole('textbox', 'Message', view), 'Look at @AddressF')
    await settle()
    const rows = Array.from(view.querySelectorAll('[role="option"]'), (row) =>
      accessibleName(row),
    )
    click(linkTo(view, fileHref))
    await settle()
    const afterFile = navigation.href()
    navigation.push(here)
    await settle()
    click(folderChip(view))
    await settle()
    expect({
      rows,
      afterFile,
      afterFolder: navigation.href(),
      lib: folderOpen(view, 'lib'),
    }).toEqual({
      rows: ['AddressForm.tsx, src/app/checkout/'],
      afterFile: fileHref,
      afterFolder: allFilesHref,
      lib: 'true',
    })
  })

  test('on desktop, a folder chip shows the right column again, with All files and the folder open', async () => {
    const { view } = await openChat('desktop')
    click(byRole('button', 'Hide the right column', view))
    await settle()
    const hidden = queryByLabel('Files and tools', view) === null
    click(folderChip(view))
    await settle()
    expect({
      hidden,
      shown: queryByLabel('Files and tools', view) !== null,
      allFiles: queryByLabel('All files', view)?.tagName,
      lib: folderOpen(view, 'lib'),
    }).toEqual({ hidden: true, shown: true, allFiles: 'UL', lib: 'true' })
  })
})
