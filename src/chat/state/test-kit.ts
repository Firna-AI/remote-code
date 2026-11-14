import type { Session } from '../../shared/generated/Session'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import {
  createApiClient,
  type FetchLike,
  type FileTransport,
} from '../../app/api/client'
import { chatHistoryPath, type WorkspaceEvent } from '../../shared/events'
import type { ChangeModelResponse } from '../../shared/sessions'
import { FakeApiServer, type FakeApiOptions } from '../../test-support/fake-api'
import type { FakeWorkspaceEvents } from '../../test-support/fake-events'
import { fetchFiles } from '../../test-support/fake-files'
import { FAKE_IDS, FAKE_TIME, fakeUser } from '../../test-support/fixtures/core'
import { senderSnapshot } from '../../test-support/fixtures/workspaces'
import { record, text } from '../api/json'
import { readDraft } from '../api/read-chat'
import type { StreamTimers } from '../stream/workspace-stream'
import { ChatController } from './controller'

/**
 * The record of a new session of the workspace, as the backend writes it,
 * with no title yet. The admin of the fake, who reads the chat by default,
 * started it, unless `more` says otherwise.
 */
export function newSessionRecord(
  sessionId: string,
  choice: AgentChoice,
  closedAt: number | null = null,
  more: Partial<Session> = {},
): Session {
  return {
    id: sessionId,
    workspaceId: FAKE_IDS.workspace,
    title: null,
    choice,
    createdAt: FAKE_TIME,
    closedAt,
    activeTurnId: null,
    activeTurnStartedAt: null,
    retryMessageId: null,
    startedBy: senderSnapshot(fakeUser),
    sourceSessionId: null,
    loginAvailable: true,
    loginShared: true,
    ...more,
  }
}

/**
 * Answers each model change as the backend does when it opens a session: the
 * new session takes the ID that the client chose, and the draft keeps the
 * files that `keeps` accepts. Other requests get the fake's recorded reply.
 */
export function opensSession(
  choice: AgentChoice,
  keeps: (attachmentId: string) => boolean = () => true,
) {
  return async (request: Request): Promise<Response | null> => {
    if (request.method !== 'PUT' || !request.url.endsWith('/model')) {
      return null
    }
    const body = record(await request.json())
    const draft = readDraft(body.draft)
    const reply: ChangeModelResponse = {
      eventNumber: 0,
      session: newSessionRecord(text(body.newSessionId), choice),
      created: true,
      draft: { ...draft, attachmentIds: draft.attachmentIds.filter(keeps) },
    }
    return Response.json(reply)
  }
}

/** Timers that run only when a test says so. */
export function manualTimers(): StreamTimers & { runAll(): void } {
  const waiting = new Map<number, () => void>()
  let next = 0
  return {
    set: (callback) => {
      next += 1
      waiting.set(next, callback)
      return setTimeout(() => {}, 0)
    },
    clear: () => {},
    runAll: () => {
      const callbacks = [...waiting.values()]
      waiting.clear()
      for (const callback of callbacks) callback()
    },
  }
}

/**
 * A chat on the fake API and its recorded events, with manual timers and
 * numbered client IDs. `after` lists where each stream subscription began.
 */
export function chatFor(
  options: FakeApiOptions & {
    workspaceId?: string
    /** Picks the requests that wait until the test lets them go. */
    hold?: (request: Request) => boolean
    /**
     * Answers a request from its body, as a stateful backend does. A null
     * answer keeps the fake's recorded reply. The fake records each request.
     */
    answer?: (request: Request) => Promise<Response | null>
    /**
     * The workspace stream of another chat, so that two chats with their
     * own readers, such as two tabs, get the same events.
     */
    stream?: FakeWorkspaceEvents
    /**
     * Sends the raw files of uploads. By default they go through the fetch
     * of the chat, with no progress, as `fetchFiles` says.
     */
    files?: FileTransport
    readOnly?: () => boolean
  } = {},
) {
  const server = new FakeApiServer(options)
  const held: (() => void)[] = []
  const fetch: FetchLike = async (input, init) => {
    const request = new Request(
      new URL(String(input), 'https://held.test'),
      init,
    )
    if (options.hold?.(request)) {
      await new Promise<void>((resolve) => held.push(resolve))
    }
    const recorded = await server.fetch(input, init)
    return (await options.answer?.(request)) ?? recorded
  }
  const after: number[] = []
  const timers = manualTimers()
  let ids = 0
  const controller = new ChatController({
    target: {
      orgId: FAKE_IDS.org,
      workspaceId: options.workspaceId ?? FAKE_IDS.workspace,
    },
    client: createApiClient(fetch, options.files ?? fetchFiles(fetch)),
    subscribe: (_target, from, listener) => {
      after.push(from)
      return (options.stream ?? server.events).subscribe(from, (message) =>
        listener.message(message),
      )
    },
    timers,
    readOnly: options.readOnly,
    newId: () => {
      ids += 1
      return `client-${ids}`
    },
  })
  /**
   * The number of the next event of the fake stream. A reply that a test
   * writes holds the state through it, as the Worker's reply of a change
   * does before the stream brings the change.
   */
  const nextEventNumber = () => server.events.history().throughEventNumber + 1
  const emit = (
    event: WorkspaceEvent,
    workspaceId: string = FAKE_IDS.workspace,
  ) => {
    const eventNumber = nextEventNumber()
    server.events.emit({
      workspaceId,
      eventNumber,
      occurredAt: FAKE_TIME,
      event,
    })
  }
  const requests = (method: string, path: string) =>
    server.requests.filter(
      (request) =>
        request.method === method && new URL(request.url).pathname === path,
    )
  const bodies = (method: string, path: string) =>
    Promise.all(
      requests(method, path).map(async (request): Promise<unknown> =>
        request.clone().json(),
      ),
    )
  /** The number of history requests for one session. */
  const histories = (sessionId: string) =>
    server.requests.filter((request) => {
      const url = new URL(request.url)
      return (
        request.method === 'GET' &&
        url.pathname === historyPathname &&
        url.searchParams.get('sessionId') === sessionId
      )
    }).length
  const historyPathname = new URL(
    chatHistoryPath(
      FAKE_IDS.org,
      options.workspaceId ?? FAKE_IDS.workspace,
      '',
    ),
    'https://held.test',
  ).pathname
  /** The draft of a session as the snapshot holds it. */
  const draftOf = (sessionId: string) =>
    controller.getSnapshot().sessionStates[sessionId]?.draft
  return {
    server,
    controller,
    after,
    timers,
    emit,
    nextEventNumber,
    requests,
    bodies,
    held,
    histories,
    draftOf,
  }
}

/** The kinds and texts of a session's transcript, in the order of the chat. */
export function shown(controller: ChatController, sessionId: string): string[] {
  const state = controller.getSnapshot().sessionStates[sessionId]
  return (state?.transcript.items ?? []).map((item) => {
    switch (item.kind) {
      case 'user':
        return `user: ${item.message.text}`
      case 'agent':
        return `agent: ${item.text}`
      case 'tool':
        return `tool: ${item.tool.target} ${item.tool.state}`
      case 'turn-end':
        return `end: ${item.durationMs}`
      case 'stopped':
        return `stopped by ${item.by ?? 'nobody'}`
      case 'failed':
        return `failed: ${item.error.message}`
      case 'lost':
        return `lost: ${item.marker.runnerEventType} ${item.marker.reason}`
      case 'continued':
        return `continued by ${item.member.githubLogin}: ${item.branch} from ${item.baseBranch}`
    }
  })
}
