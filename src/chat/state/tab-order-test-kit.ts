import type { Session } from '../../shared/generated/Session'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import { createApiClient } from '../../app/api/client'
import { sessionsPath } from '../../shared/sessions'
import {
  workspaceViewPath,
  type TemporaryTab,
  type WorkspaceTab,
  type WorkspaceView,
} from '../../shared/workspace-view'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import { createChatApi } from '../api/client'
import { readView } from '../api/read-responses'
import { tabSessions } from './archive-view'
import { rowTabs } from './tab-order'
import { chatFor } from './test-kit'

export const org = FAKE_IDS.org
export const ws = FAKE_IDS.workspace
export const viewPath = workspaceViewPath(org, ws)
export const choice: AgentChoice = {
  agent: 'claude',
  model: 'Opus 5.5',
  effort: 'high',
  fast: false,
}
export const first: WorkspaceTab = {
  kind: 'session',
  sessionId: FAKE_IDS.session,
}
export const second: WorkspaceTab = { kind: 'session', sessionId: 'debounce' }
export const closed: WorkspaceTab = { kind: 'session', sessionId: 'postcode' }
export const file: WorkspaceTab = {
  kind: 'file',
  path: 'src/app.ts',
  mode: 'source',
}
export const diff: WorkspaceTab = { kind: 'diff', path: 'src/app.ts' }

/**
 * A fake server that stores view writes and serves them through the view
 * route. The saved view marks `temporaryTab` as its temporary tab, else none.
 */
export function tabChat(
  tabs: readonly WorkspaceTab[],
  {
    temporaryTab = null,
    ...options
  }: Parameters<typeof chatFor>[0] & {
    temporaryTab?: TemporaryTab | null
  } = {},
) {
  const saving: Promise<void>[] = []
  const completed: (() => void)[] = []
  const isSave = (request: Request) =>
    request.method === 'PUT' && new URL(request.url).pathname === viewPath
  const chat = chatFor({
    ...options,
    hold: (request) => {
      if (isSave(request)) {
        saving.push(new Promise<void>((resolve) => completed.push(resolve)))
      }
      return options.hold?.(request) ?? false
    },
    answer: async (request) => {
      if (!isSave(request)) return options.answer?.(request) ?? null
      const view = readView({ view: await request.json() })
      chat.server.json('GET', viewPath, { view })
      completed.shift()?.()
      return Response.json({ view })
    },
  })
  const view: WorkspaceView = {
    tabs,
    activeTab: first,
    fileList: 'changes',
    temporaryTab,
    tool: 'terminal',
  }
  chat.server.json('GET', viewPath, { view })
  const api = createChatApi(createApiClient(chat.server.fetch), {
    orgId: org,
    workspaceId: ws,
  })
  return {
    ...chat,
    savedView: async () => {
      await Promise.all(saving)
      return (await api.view()).view
    },
    writes: () => chat.server.requests.filter((item) => item.method !== 'GET'),
    row: (files = true) => {
      const snapshot = chat.controller.getSnapshot()
      return rowTabs(snapshot.view, tabSessions(snapshot), files)
    },
    setSessions: (
      sessions: readonly Session[],
      history: readonly Session[] = [],
    ) =>
      chat.server.json('GET', sessionsPath(org, ws), {
        eventNumber: 0,
        sessions,
        history,
      }),
  }
}
