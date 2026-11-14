import type { MessageSender } from '../shared/generated/MessageSender'
import type { UserMessage } from '../shared/generated/UserMessage'
import type { FetchLike } from '../app/api/client'
import { flag, record, text } from '../app/api/parse'
import { readOrderedWorkspaceResponse } from '../app/api/read-workspaces'
import { readChoice } from '../chat/api/read-chat'
import { readSessions } from '../chat/api/read-responses'
import type { WorkspaceEvent } from '../shared/events'
import { filePaths } from '../shared/files'
import { githubPaths, type GitHubMergeMethod } from '../shared/github'
import { sessionsPath } from '../shared/sessions'
import { workspacePath, workspacePaths } from '../shared/workspaces'
import type { FakeApiServer } from './fake-api'
import {
  CONTINUE_ID,
  CONTINUED_BRANCH,
  continuedEvents,
  continuedReply,
  serveAccess,
  serveContinue,
  serveMerge,
  serveWork,
  workReport,
  type FakeAccess,
  type FakeContinueEnd,
  type FakeMergeEnd,
  type FakeWork,
} from './fake-bar'
import { FAKE_IDS, FAKE_ORIGIN } from './fixtures/core'
import { toolFixtures } from './fixtures/tools'
import { nextEnvelope } from './recorded-repairs'

/** The answers of the bar actions on a development page. */
export interface BarScenario {
  access: FakeAccess
  method: GitHubMergeMethod | 'none'
  merge: FakeMergeEnd
  work: FakeWork
  continue: FakeContinueEnd
}

/** The answers that the address of a development page can choose. */
export const scenarioValues: {
  readonly [K in keyof BarScenario]: readonly BarScenario[K][]
} = {
  access: ['write', 'read', 'unknown'],
  method: ['squash', 'merge', 'rebase', 'none'],
  merge: ['merged', 'moved-head', 'no-right', 'refused', 'unavailable'],
  work: ['none', 'files', 'restored', 'commits', 'legacy'],
  continue: ['continued', 'question', 'clash', 'stopped', 'turn'],
}

function pick<T extends string>(values: readonly T[], value: string | null): T {
  return values.find((item) => item === value) ?? values[0]
}

/**
 * The answers in the address. The first value of each answer is the
 * default: a member with write access and squash, a merge and a Continue
 * that succeed, and no local work.
 */
export function readScenario(query: URLSearchParams): BarScenario {
  const { access, method, merge, work } = scenarioValues
  return {
    access: pick(access, query.get('access')),
    method: pick(method, query.get('method')),
    merge: pick(merge, query.get('merge')),
    work: pick(work, query.get('work')),
    continue: pick(scenarioValues.continue, query.get('continue')),
  }
}

const org = FAKE_IDS.org
const id = FAKE_IDS.workspace

async function read<T>(
  server: FakeApiServer,
  path: string,
  reader: (value: unknown) => T,
): Promise<T> {
  const response = await server.fetch(path)
  return reader(await response.json())
}

/** The JSON body of a request, as the Worker reads it. */
function bodyOf(init: RequestInit | undefined) {
  return record(JSON.parse(String(init?.body)), 'request')
}

/**
 * A fetch over the fake server that answers the bar actions of a scenario
 * as the Worker does with its state. A completed merge publishes the merged
 * state, a Continue publishes the workspace on its new branch with a note
 * in each session, and a message shows the text that it sent. Every other
 * request gets the recorded reply. Development only.
 */
export function scenarioFetch(
  server: FakeApiServer,
  scenario: BarScenario,
  member: MessageSender,
  now: () => number,
): FetchLike {
  serveAccess(
    server,
    scenario.access,
    scenario.method === 'none' ? null : scenario.method,
  )
  serveMerge(server, scenario.merge)
  serveWork(server, scenario.work)
  serveContinue(server, scenario.continue)
  let continues = scenario.continue === 'continued'
  const emit = (event: WorkspaceEvent) =>
    server.events.emit(nextEnvelope(server.events, event, now()))
  const showGitHub = (event: WorkspaceEvent) => {
    if (event.type !== 'github.updated') return
    server.json('GET', githubPaths.banner(org, id), { banner: event.banner })
    server.json('GET', githubPaths.checks(org, id), event.checks)
    server.json('GET', githubPaths.stored(org, id), {
      state: { banner: event.banner, checks: event.checks },
    })
  }
  const publishMerge = () => {
    const merged = toolFixtures('merged')
    const event: WorkspaceEvent = {
      type: 'github.updated',
      banner: merged.banner.banner,
      checks: merged.checks,
    }
    showGitHub(event)
    emit(event)
  }
  const publishContinue = async () => {
    const detail = await read(
      server,
      workspacePath(org, id),
      readOrderedWorkspaceResponse,
    )
    const { sessions, history } = await read(
      server,
      sessionsPath(org, id),
      readSessions,
    )
    // The changed files move to the new branch. The commits stay behind.
    const moved = workReport(scenario.work).files.filter(
      (file) => file.uncommitted,
    )
    const events = continuedEvents(
      detail.workspace,
      [...sessions, ...history],
      member,
      moved,
    )
    for (const event of events) {
      showGitHub(event)
      if (event.type === 'changes.updated') {
        server.json('GET', filePaths.changes(org, id), event.changes)
      }
      emit(event)
    }
    const last = server.events.history(
      Number.MAX_SAFE_INTEGER,
    ).throughEventNumber
    const workspace = {
      ...detail.workspace,
      branch: CONTINUED_BRANCH,
      github: null,
    }
    server.json('GET', workspacePath(org, id), {
      ...detail,
      workspace,
      eventNumber: last,
    })
    continuedReply(server, workspace, last)
    continues = false
  }
  const echo = async (path: string, init: RequestInit | undefined) => {
    const body = bodyOf(init)
    const sessionId = decodeURIComponent(path.split('/').at(-2) ?? '')
    const { sessions } = await read(server, sessionsPath(org, id), readSessions)
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) return server.fetch(path, init)
    const message: UserMessage = {
      id: text(body, 'id'),
      sessionId,
      sender: member,
      text: text(body, 'text'),
      attachments: [],
      choice: readChoice(body.choice),
      createdAt: now(),
      state: 'sent',
    }
    emit({ type: 'message.accepted', message })
    const eventNumber = server.events.history(
      Number.MAX_SAFE_INTEGER,
    ).throughEventNumber
    return Response.json(
      { eventNumber, message, turnId: null, session },
      { status: 202 },
    )
  }
  return async (input, init) => {
    const { pathname } = new URL(input, FAKE_ORIGIN)
    const method = init?.method ?? 'GET'
    if (method === 'POST' && pathname.endsWith('/messages'))
      return echo(pathname, init)
    if (
      method === 'GET' &&
      pathname === githubPaths.mergeResult(org, id, `merge-${id}`)
    ) {
      if (scenario.merge === 'merged') publishMerge()
    }
    if (method === 'POST' && pathname === workspacePaths.continue(org, id)) {
      const body = bodyOf(init)
      if (body.allowLocalWork !== undefined && flag(body, 'allowLocalWork')) {
        continues = true
      }
    }
    if (
      method === 'GET' &&
      pathname === workspacePaths.continueResult(org, id, CONTINUE_ID)
    ) {
      if (continues) await publishContinue()
    }
    return server.fetch(input, init)
  }
}
