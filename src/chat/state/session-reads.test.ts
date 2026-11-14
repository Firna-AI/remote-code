import type { Workspace } from '../../shared/generated/Workspace'
import { describe, expect, test } from 'vitest'
import { flushMicrotasks } from '../../app/test-kit'
import { sessionsPath } from '../../shared/sessions'

import { FAKE_IDS } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import { chatFor } from './test-kit'

const other = workspaceFixtures().workspaces.workspaces.find(
  (item) => item.id !== FAKE_IDS.workspace,
) as Workspace
const otherSessions = new URL(
  sessionsPath(FAKE_IDS.org, other.id),
  'https://held.test',
).pathname

describe('the reads of linked sessions in a chat', () => {
  test('a read from an earlier load does not fill the reads of the next load', async () => {
    const chat = chatFor({
      hold: (request) => new URL(request.url).pathname === otherSessions,
    })
    await chat.controller.start()
    chat.controller.sessionReads.need(other.id)
    await flushMicrotasks()
    await chat.controller.start()
    for (const release of chat.held) release()
    await flushMicrotasks()
    expect(chat.controller.sessionReads.getSnapshot()).toEqual({})
  })
})
