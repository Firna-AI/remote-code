import { describe, expect, it, vi } from 'vitest'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { sessionPath, sessionPaths } from '../../shared/sessions'
import { workspacePaths } from '../../shared/workspaces'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { chatFor } from './test-kit'

const org = FAKE_IDS.org
const ws = FAKE_IDS.workspace
const id = FAKE_IDS.session
const opus: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}
const shortly = { timeout: 10_000 }
const failure = {
  error: { code: 'internal_error', message: 'The request failed. Try again.' },
}

describe('records that arrive out of order', () => {
  it('keeps the confirmed newer rename while an older rename still waits', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) => request.method === 'PATCH',
    })
    await chat.controller.start()
    const [session] = chat.controller.getSnapshot().sessions
    const title = () => chat.controller.getSnapshot().sessions[0].title
    const after = chat.nextEventNumber()
    const answer = (name: string, eventNumber: number) =>
      chat.server.json('PATCH', sessionPath(org, ws, id), {
        session: { ...session, title: name },
        eventNumber,
      })
    const first = chat.controller.rename(id, 'Lookups')
    const second = chat.controller.rename(id, 'Postcode lookups')
    answer('Postcode lookups', after + 1)
    chat.held.splice(1, 1)[0]()
    await second
    expect(title()).toBe('Postcode lookups')
    answer('Lookups', after)
    chat.held.splice(0, 1)[0]()
    await first
    expect(title()).toBe('Postcode lookups')
  })

  it('takes back each failed rename to the newest record, also when two fail', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) => request.method === 'PATCH',
    })
    await chat.controller.start()
    const title = () => chat.controller.getSnapshot().sessions[0].title
    const before = title()
    chat.server.json('PATCH', sessionPath(org, ws, id), failure, 500)
    const first = chat.controller.rename(id, 'Lookups')
    const second = chat.controller.rename(id, 'Postcode lookups')
    expect(title()).toBe('Postcode lookups')
    await vi.waitFor(() => expect(chat.held).toHaveLength(2), shortly)
    chat.held.splice(0, 1)[0]()
    await first
    expect(title()).toBe('Postcode lookups')
    chat.held.splice(0, 1)[0]()
    await second
    expect(title()).toBe(before)
  })

  it('keeps a quickly reopened session shown when the stream brings its close after the replies', async () => {
    const chat = chatFor({ conversation: 'history' })
    await chat.controller.start()
    const [session] = chat.controller.getSnapshot().sessions
    const closed = { ...session, closedAt: FAKE_TIME + 1 }
    const closing = chat.nextEventNumber()
    chat.server.json('POST', sessionPaths.close(org, ws, id), {
      session: closed,
      eventNumber: closing,
    })
    chat.server.json('POST', sessionPaths.reopen(org, ws, id), {
      session,
      eventNumber: closing + 1,
    })
    await chat.controller.requestClose(id)
    await chat.controller.reopen(id)
    const shown = () => chat.controller.getSnapshot().activeSessionId
    expect(shown()).toBe(id)
    chat.emit({ type: 'session.updated', session: closed })
    expect(shown()).toBe(id)
    const open = () =>
      chat.controller.getSnapshot().sessions.map((item) => item.id)
    expect(open()).toContain(id)
    chat.emit({ type: 'session.updated', session })
    expect(shown()).toBe(id)
    expect(open()).toContain(id)
  })

  it('keeps a pending rename and model over an older record from the stream', async () => {
    const chat = chatFor({
      conversation: 'history',
      hold: (request) => request.method === 'PATCH' || request.method === 'PUT',
    })
    await chat.controller.start()
    const [session] = chat.controller.getSnapshot().sessions
    const sonnet: AgentChoice = { ...opus, model: 'Sonnet 5.5' }
    const record = () => chat.controller.getSnapshot().sessions[0]
    const renaming = chat.controller.rename(id, 'Lookups')
    const choosing = chat.controller.chooseModel(id, sonnet)
    await vi.waitFor(() => expect(chat.held).toHaveLength(2), shortly)
    // The server wrote this change before it took the rename and the model.
    const older = { ...session, loginAvailable: false }
    chat.emit({ type: 'session.updated', session: older })
    expect(record()).toMatchObject({
      title: 'Lookups',
      choice: sonnet,
      loginAvailable: false,
    })
    const renamed = { ...older, title: 'Lookups' }
    const after = chat.nextEventNumber()
    chat.server.json('PATCH', sessionPath(org, ws, id), {
      session: renamed,
      eventNumber: after,
    })
    chat.server.json('PUT', sessionPaths.model(org, ws, id), {
      session: { ...renamed, choice: sonnet },
      created: false,
      draft: { text: '', attachmentIds: [] },
      eventNumber: after + 1,
    })
    for (const release of chat.held.splice(0)) release()
    await Promise.all([renaming, choosing])
    expect(record()).toMatchObject({ title: 'Lookups', choice: sonnet })
  })

  it('keeps the state of a Resume reply when the stream brings an older workspace event after it', async () => {
    const chat = chatFor({ conversation: 'history', workspaceState: 'stopped' })
    await chat.controller.start()
    const stopped = chat.controller.getSnapshot().workspace
    if (!stopped) throw new Error('The workspace did not load.')
    const stepAt = FAKE_TIME + 1
    const start = {
      kind: 'resume',
      startedAt: stepAt,
      steps: [
        {
          id: 'restore',
          label: 'Resuming with your files as you left them',
          state: 'running',
          startedAt: stepAt,
          completedAt: null,
        },
      ],
    }
    // The stream still has to bring the stop that came before the Resume.
    const stop = chat.nextEventNumber()
    chat.server.json('POST', workspacePaths.resume(org, ws), {
      workspace: { ...stopped, state: 'starting' },
      start,
      error: null,
      eventNumber: stop + 1,
    })
    await chat.controller.resume()
    const state = () => chat.controller.getSnapshot().workspace?.state
    expect(state()).toBe('starting')
    chat.emit({ type: 'workspace.updated', workspace: stopped })
    expect(state()).toBe('starting')
    expect(chat.controller.getSnapshot().start).toEqual(start)
  })
})
