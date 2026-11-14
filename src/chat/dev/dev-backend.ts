import type { Session } from '../../shared/generated/Session'
import type { Workspace } from '../../shared/generated/Workspace'
import type { MessageSender } from '../../shared/generated/MessageSender'
import type { UserMessage } from '../../shared/generated/UserMessage'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import { handleTranscript } from './dev-transcript'
import { createApiClient } from '../../app/api/client'
import type { AgentLoginStatus } from '../../shared/account'
import { chatHistoryPath, type WorkspaceEvent } from '../../shared/events'

import { sessionsPath } from '../../shared/sessions'
import { workspacePath } from '../../shared/workspaces'
import { FakeApiServer } from '../../test-support/fake-api'
import { fetchFiles } from '../../test-support/fake-files'
import {
  coreFixtures,
  FAKE_IDS,
  FAKE_ORIGIN,
} from '../../test-support/fixtures/core'
import { senderSnapshot } from '../../test-support/fixtures/workspaces'
import { recordedChatEvents } from '../../test-support/recorded-chat'
import { recordedFileEvents } from '../../test-support/recorded-files'
import { createChatApi, type WorkspaceTarget } from '../api/client'
import { endsTurn } from '../../shared/transcript/known-turns'
import type { Clock } from '../ui/clock'
import { DevAgent } from './dev-agent'
import { devScripts, type DevScript } from './dev-answers'
import {
  seedLinked,
  withReaderLogin,
  withStarter,
  writeReaderLogins,
} from './dev-logins'
import { DevMac, handleMacWrite, writeMacReplies } from './dev-mac'
import { lossEvents } from './dev-loss'
import type { DevOptions } from './dev-options'
import { handleWrite } from './dev-routes'
import { takeState } from './dev-sandbox'
import { followTitle, setActiveTurn } from './dev-sessions'
import { changesTurnEnds, withTurnEnds } from './dev-speed'
import { DevStream } from './dev-stream'

const NEW_WORKSPACE = 'saved-carts'

/** The fake API of the development page, with writes that change its state. */
export class DevBackend {
  readonly target: WorkspaceTarget
  readonly stream: DevStream
  readonly agent: DevAgent
  /** The Mac that acts on the answers to Mac commands. */
  readonly mac: DevMac
  readonly server: FakeApiServer
  readonly clock: Clock
  readonly messages = new Map<string, UserMessage>()
  /** The member who reads the page, who sends, starts sessions, and presses Stop. */
  readonly viewer: MessageSender
  /** The agent logins of the reader, which each session of the reader records. */
  readonly logins: readonly AgentLoginStatus[]
  /** The recorded turn that runs in a session, which Stop and steer reach. */
  readonly recordedTurns = new Map<string, string>()
  workspace: Workspace
  start: WorkspaceStart | null
  open: Session[]
  closed: Session[]
  queue: UserMessage[] = []
  timers: number[] = []
  count = 0
  /** The first session of a new workspace, which follows its title. */
  titled: string | null = null
  /** The new workspace asked for its title, which then comes on its own. */
  titleAsked = false

  private constructor(parts: {
    target: WorkspaceTarget
    viewer: MessageSender
    logins: readonly AgentLoginStatus[]
    server: FakeApiServer
    clock: Clock
    stream: DevStream
    workspace: Workspace
    start: WorkspaceStart | null
    open: Session[]
    closed: Session[]
    mac: DevMac
    script: DevScript
  }) {
    this.target = parts.target
    this.viewer = parts.viewer
    this.logins = parts.logins
    this.server = parts.server
    this.clock = parts.clock
    this.stream = parts.stream
    this.workspace = parts.workspace
    this.start = parts.start
    this.open = parts.open
    this.closed = parts.closed
    this.mac = parts.mac
    this.agent = new DevAgent(parts.stream, parts.clock, parts.script)
    this.agent.onTurn = (sessionId, turnId, at) =>
      setActiveTurn(this, sessionId, turnId, at)
  }

  static async create(options: DevOptions, clock: Clock): Promise<DevBackend> {
    const { scenario } = options
    const loss = scenario === 'loss'
    const server = new FakeApiServer({
      role: options.role,
      workspaceState: options.state,
      conversation: scenario === 'loss' ? 'history' : scenario,
      macCommands: options.mac,
      onMac: options.app === 'mac',
    })
    const org = FAKE_IDS.org
    const workspaceId =
      options.workspace === 'new' ? NEW_WORKSPACE : FAKE_IDS.workspace
    const target = { orgId: org, workspaceId }
    const logins = writeReaderLogins(server, options)
    const claudeLogin = logins.some(
      (login) => login.agent === 'claude' && login.connected,
    )
    const api = createChatApi(createApiClient(server.fetch), target)
    const [detail, listed, { view }] = await Promise.all([
      api.workspace(),
      api.sessions(),
      api.view(),
    ])
    const viewer = senderSnapshot(coreFixtures(options.role).account.user)
    const list = withReaderLogin(
      withStarter(listed, options.starter),
      viewer.id,
      claudeLogin,
    )
    const shown = list.sessions[0]?.id ?? 'new'
    const events =
      scenario === 'loss'
        ? lossEvents(workspaceId, shown, viewer.id)
        : recordedChatEvents(scenario, workspaceId, shown)
    const recorded = withTurnEnds(events, options)
    const live = options.replay === 'live'
    const files = recordedFileEvents(
      workspaceId,
      live ? 1 : recorded.length + 1,
    )
    if (live || loss || changesTurnEnds(options)) {
      const path = chatHistoryPath(org, workspaceId, shown)
      server.json('GET', path, {
        events: live ? [] : recorded,
        throughEventNumber: live ? 0 : recorded.length,
      })
    }
    const backend = new DevBackend({
      target,
      viewer,
      logins,
      server,
      clock,
      stream: new DevStream(
        workspaceId,
        clock,
        live ? files : [...recorded, ...files],
      ),
      workspace: detail.workspace,
      start: detail.start,
      open: [...list.sessions],
      closed: [...list.history],
      mac: new DevMac(
        options.mac,
        clock.now(),
        options.app === 'mac',
        options.change,
      ),
      script: devScripts[options.answer],
    })
    backend.note(recorded.map((envelope) => envelope.event))
    writeMacReplies(backend)
    if (options.workspace === 'new') {
      followTitle(backend)
      if (options.state !== 'starting') takeState(backend, options.state)
    }
    if (live) backend.replay(recorded.map((envelope) => envelope.event))
    if (list !== listed) backend.sync()
    if (options.starter === 'linked') seedLinked(backend, view)
    return backend
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(String(input), FAKE_ORIGIN), init)
    const written =
      (await handleTranscript(this, request)) ??
      (await handleMacWrite(this, request)) ??
      (await handleWrite(this, request))
    return written ?? this.server.fetch(request)
  }

  /**
   * The JSON client of the page, over its fake API, as the app gives one.
   * Its uploads send raw files through the same fetch.
   */
  readonly client = createApiClient(this.fetch, fetchFiles(this.fetch))

  /** Keeps the messages, the queued ones, and the running turn of the recorded chat. */
  private note(events: readonly WorkspaceEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'message.accepted':
          this.messages.set(event.message.id, event.message)
          if (event.message.state === 'queued') this.queue.push(event.message)
          break
        case 'message.sent':
          this.queue = this.queue.filter((item) => item.id !== event.messageId)
          break
        case 'turn.started':
          this.recordedTurns.set(event.sessionId, event.turnId)
          this.queue = this.queue.filter(
            (item) => !event.messageIds.includes(item.id),
          )
          break
        case 'turn.completed':
        case 'turn.failed':
          this.endRecorded(event.sessionId, event.turnId)
          break
        case 'runner.event-refused':
          // A refused end still ends its turn, as the chat shows it.
          if (event.sessionId && event.turnId && endsTurn(event)) {
            this.endRecorded(event.sessionId, event.turnId)
          }
          break
      }
    }
  }

  /**
   * Forgets the recorded turn of a session when this end names it. A late
   * end of an older turn, or a marker of a turn that never started, leaves
   * the running turn as it is.
   */
  private endRecorded(sessionId: string, turnId: string): void {
    if (this.recordedTurns.get(sessionId) === turnId) {
      this.recordedTurns.delete(sessionId)
    }
  }

  /** Plays the recorded chat into the stream, one event at a time. */
  private replay(events: readonly WorkspaceEvent[]): void {
    events.forEach((event, index) => {
      this.timers.push(
        window.setTimeout(
          () => this.stream.emit(this.fresh(event)),
          900 + index * 450,
        ),
      )
    })
  }

  /** A recorded event at the time now, so a replayed turn counts from zero. */
  private fresh(event: WorkspaceEvent): WorkspaceEvent {
    const now = this.clock.now()
    if (event.type === 'turn.started') return { ...event, startedAt: now }
    if (event.type !== 'message.accepted') return event
    return { ...event, message: { ...event.message, createdAt: now } }
  }

  /**
   * Writes the current records as the fake's replies, and tells the tabs.
   * Each read carries the number of the last event, as the Worker's do.
   */
  sync(): void {
    const { orgId, workspaceId } = this.target
    const eventNumber = this.stream.last
    this.server.json('GET', sessionsPath(orgId, workspaceId), {
      eventNumber,
      sessions: this.open,
      history: this.closed,
    })
    this.server.json('GET', workspacePath(orgId, workspaceId), {
      eventNumber,
      workspace: this.workspace,
      start: this.start,
      error:
        this.workspace.state === 'error'
          ? {
              code: 'start_failed',
              message: 'The cloud computer did not start.',
              log: null,
            }
          : null,
    })
  }

  dispose(): void {
    this.agent.dispose()
    for (const timer of this.timers) window.clearTimeout(timer)
  }
}
