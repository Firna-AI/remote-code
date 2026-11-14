import type { GitHubSummary } from '../shared/generated/GitHubSummary'
import type { WorkspaceState } from '../shared/generated/WorkspaceState'
import type { PathState } from '../../docs/mockups/src/fixtures/maskedFiles'
import type { SessionResponse } from '../shared/account'
import { API_PATHS, type OrgRole, type User } from '../shared/api'
import { chatHistoryPath } from '../shared/events'
import { githubSummary, type BannerState } from '../shared/github'

import { chatEventsOf } from '../shared/transcript/session-events'
import type { FakeMethod, FakeRouteWriter } from './fake-api-routes'
import { fakeCoreRoutes } from './fake-core-routes'
import { fakeDeviceRoutes } from './fake-device-routes'
import { FakeWorkspaceEvents } from './fake-events'
import { fakeToolRoutes } from './fake-tool-routes'
import { fakeWorkspaceRoutes } from './fake-workspace-routes'
import { FAKE_IDS, FAKE_ORIGIN } from './fixtures/core'
import type { FakeMacScenario } from './fixtures/devices'
import {
  maskedChangedFiles,
  withMaskedTurnFiles,
} from './fixtures/masked-paths'
import { toolFixtures } from './fixtures/tools'
import { workspaceFixtures } from './fixtures/workspaces'
import { recordedChatEvents, type RecordedChatScenario } from './recorded-chat'
import { recordedFileEvents } from './recorded-files'

export interface FakeApiOptions {
  role?: OrgRole
  workspaceState?: WorkspaceState
  conversation?: RecordedChatScenario
  banner?: BannerState
  /**
   * The GitHub state of the record of the fake workspace. Without it, the
   * record has the GitHub state of `banner`, so that its list mark and its
   * bar agree. `null` gives a record without one, whatever the bar shows.
   */
  github?: GitHubSummary | null
  /** The Mac commands of the fake workspace. */
  macCommands?: FakeMacScenario
  /** The window is the Mac app on the Mac of the fake user. */
  onMac?: boolean
  /**
   * `masked` adds two files whose real paths hold a fake secret value, with
   * the labels of the mockups, to the file lists and to each finished turn.
   */
  paths?: PathState
  /**
   * `false` leaves the file reports out of the event history, as a new
   * workspace whose runner has not reported its lists yet.
   */
  savedLists?: boolean
}

/**
 * The GitHub state of the record of the fake workspace: `github` when the
 * options give it, also `null`, or else the state of the bar of `banner`, as
 * the Worker copies it.
 */
export function fakeGitHubSummary(
  options: Pick<FakeApiOptions, 'banner' | 'github'>,
): GitHubSummary | null {
  if (options.github !== undefined) return options.github
  return githubSummary(toolFixtures(options.banner).banner.banner)
}

function routeKey(method: string, path: string): string {
  const url = new URL(path, FAKE_ORIGIN)
  url.searchParams.sort()
  return `${method} ${url.pathname}${url.search}`
}

/**
 * Fetch-compatible, in-memory server for development and tests.
 * Writes return recorded replies, except org moves, which update the org list.
 * Override a reply with json(), empty(), or response() for the next screen state.
 * A file upload names its file in its query, so a reply for the path of an
 * upload route answers each file sent there.
 * This module is opt-in. The production Worker never imports it.
 */
export class FakeApiServer implements FakeRouteWriter {
  readonly requests: Request[] = []
  readonly events: FakeWorkspaceEvents
  private readonly replies = new Map<
    string,
    Response | Promise<Response> | ((request: Request) => Promise<Response>)
  >()

  constructor(options: FakeApiOptions = {}) {
    const conversation = options.conversation ?? 'history'
    const paths = options.paths ?? 'plain'
    const recorded = recordedChatEvents(conversation)
    const chat =
      paths === 'masked'
        ? withMaskedTurnFiles(recorded, maskedChangedFiles())
        : recorded
    this.events = new FakeWorkspaceEvents([
      ...chat,
      ...(options.savedLists === false
        ? []
        : recordedFileEvents(FAKE_IDS.workspace, chat.length + 1, paths)),
    ])
    fakeCoreRoutes(this, options.role ?? 'admin')
    fakeWorkspaceRoutes(
      this,
      options.workspaceState ?? 'ready',
      conversation,
      paths,
      fakeGitHubSummary(options),
    )
    fakeToolRoutes(this, options.banner ?? 'ready-to-merge', paths)
    const { workspaces, created } = workspaceFixtures(options.workspaceState)
    fakeDeviceRoutes(
      this,
      options.macCommands ?? 'none',
      options.onMac ?? false,
      [
        ...workspaces.workspaces.map((workspace) => workspace.id),
        created.workspace.id,
      ],
    )
  }

  /** Serves the session of `user`, with app access, as a sign-in of that person does. */
  signIn(user: User): void {
    this.json('GET', API_PATHS.session, {
      user,
      appAccess: true,
    } satisfies SessionResponse)
  }

  json(method: FakeMethod, path: string, body: unknown, status = 200): void {
    if (body instanceof Promise) {
      this.replies.set(
        routeKey(method, path),
        body.then((value: unknown) => Response.json(value, { status })),
      )
      return
    }
    this.response(method, path, Response.json(body, { status }))
  }

  empty(method: FakeMethod, path: string): void {
    this.response(method, path, new Response(null, { status: 204 }))
  }

  response(method: FakeMethod, path: string, response: Response): void {
    this.replies.set(routeKey(method, path), response.clone())
  }

  handle(
    method: FakeMethod,
    path: string,
    handler: (request: Request) => Promise<Response>,
  ): void {
    this.replies.set(routeKey(method, path), handler)
  }

  fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(String(input), FAKE_ORIGIN), init)
    this.requests.push(request.clone())
    const url = new URL(request.url)
    const key = routeKey(request.method, request.url)
    const response = await (this.replies.get(key) ?? this.uploadReply(request))
    if (typeof response === 'function') return response(request)
    if (response) return response.clone()
    const historyPath = new URL(
      chatHistoryPath(FAKE_IDS.org, FAKE_IDS.workspace, FAKE_IDS.session),
      FAKE_ORIGIN,
    ).pathname
    if (request.method === 'GET' && url.pathname === historyPath) {
      const history = this.events.history()
      const through = Number(
        url.searchParams.get('through') ?? history.throughEventNumber,
      )
      const before = Number(url.searchParams.get('before') ?? through + 1)
      const numbers = new Set(
        chatEventsOf(
          url.searchParams.get('sessionId') ?? '',
          history.events,
        ).map(({ eventNumber }) => eventNumber),
      )
      return Response.json({
        events: history.events.filter(
          ({ eventNumber }) =>
            numbers.has(eventNumber) &&
            eventNumber <= through &&
            eventNumber < before,
        ),
        throughEventNumber: through,
      })
    }
    return Response.json(
      {
        error: {
          code: 'fake_route_missing',
          message: `No fake reply for ${key}`,
        },
      },
      { status: 404 },
    )
  }

  /** The reply for the path of a raw file upload, whatever file it names. */
  private uploadReply(
    request: Request,
  ):
    | Response
    | Promise<Response>
    | ((request: Request) => Promise<Response>)
    | undefined {
    if (request.headers.get('Content-Type') !== 'application/octet-stream') {
      return undefined
    }
    const path = new URL(request.url).pathname
    return this.replies.get(routeKey(request.method, path))
  }
}
