import type { Preview } from '../../shared/generated/Preview'
import { desktopPath } from '../../shared/desktop'
import type { WorkspaceEvent } from '../../shared/events'

import { previewsPath } from '../../shared/previews'
import { terminalPaths } from '../../shared/terminal'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_IDS, FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import {
  fullReport,
  nextEnvelope,
  storeFailedRepairs,
} from '../../test-support/recorded-repairs'
import { isRecord, type ApiFetch } from '../tool-parts/request'
import type { SubscribeWorkspaceEvents } from '../tool-parts/workspace'
import type { DevHold } from './devTerminal'

export const devTools = ['terminal', 'preview', 'desktop'] as const
export type DevTool = (typeof devTools)[number]

/** The states that the development page can draw for each tool. */
export const devStates: Readonly<Record<DevTool, readonly string[]>> = {
  terminal: ['ready', 'starting', 'stopped', 'error', 'malformed', 'late'],
  preview: ['open', 'none', 'error'],
  desktop: ['ready', 'error'],
}

/**
 * The report of the listening ports that the page stores before the tools
 * show: the sample servers, a report with no server, no report, or the
 * sample servers with a failed repair of the list 3 minutes ago.
 */
export const devPortReports = ['servers', 'empty', 'unknown', 'failed'] as const
export type DevPortReport = (typeof devPortReports)[number]

function storePortReport(server: FakeApiServer, report: DevPortReport): void {
  if (report === 'unknown') return
  const event: WorkspaceEvent =
    report === 'empty'
      ? { type: 'ports.updated', ports: [] }
      : fullReport('ports.updated')
  server.events.emit(nextEnvelope(server.events, event, FAKE_TIME - 600_000))
  if (report === 'failed') {
    storeFailedRepairs(server.events, ['ports.updated'], FAKE_TIME)
  }
}

export interface DevRequest {
  method: string
  path: string
  body: string
  status: number
}

const failure = {
  error: { code: 'unavailable', message: 'The sandbox does not answer.' },
}

/**
 * A local page in place of a previewed app or a desktop stream. The address
 * is built as text, because Vite rewrites `new URL()` with `import.meta.url`.
 */
function fixtureUrl(name: 'preview' | 'desktop', suffix: string): string {
  const folder = import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))
  return `${folder}/fixtures/${name}${suffix}`
}

/**
 * The opens that the fakes of this page answered. Each open gets the next
 * `opened-` ID, which no listed sample and no earlier open has.
 */
let opens = 0

function devPreview(id: string, port: number): Preview {
  return {
    id,
    port,
    url: fixtureUrl('preview', `?port=${port}`),
    expiresAt: FAKE_TIME + 86_400_000,
  }
}

/** The fake API with the replies of one state of one tool. */
export function createDevServer(
  tool: DevTool,
  state: string,
  ports: DevPortReport,
): FakeApiServer {
  const server = new FakeApiServer({ conversation: 'running' })
  storePortReport(server, ports)
  const org = FAKE_IDS.org
  const id = FAKE_IDS.workspace
  server.json('GET', previewsPath(org, id), {
    previews: [devPreview(FAKE_IDS.preview, 3000)],
  })
  server.json('GET', desktopPath(org, id), {
    url: fixtureUrl('desktop', '#fake-desktop-token'),
    expiresAt: FAKE_TIME + 600_000,
  })
  const terminal = terminalPaths.connection(org, id)
  const waiting = state === 'starting' || state === 'stopped'
  if (tool === 'terminal' && waiting) {
    server.json('GET', terminal, { state, socketPath: null })
  }
  if (tool === 'terminal' && state === 'late') {
    server.json('GET', terminal, { state: 'starting', socketPath: null })
  }
  if (tool === 'terminal' && state === 'error') {
    server.json('GET', terminal, failure, 503)
  }
  if (tool === 'terminal' && state === 'malformed') {
    server.json('GET', terminal, { state: 'ready' })
  }
  if (tool === 'preview' && state === 'none') {
    server.json('GET', previewsPath(org, id), { previews: [] })
  }
  if (tool === 'preview' && state === 'error') {
    server.json('GET', previewsPath(org, id), failure, 503)
  }
  if (tool === 'desktop' && state === 'error') {
    server.json('GET', desktopPath(org, id), failure, 503)
  }
  return server
}

function requestedPort(body: string): number | null {
  try {
    const value: unknown = JSON.parse(body)
    return isRecord(value) && typeof value.port === 'number' ? value.port : null
  } catch {
    return null
  }
}

/**
 * The fake API's fetch, with a log. It records a reply for each preview write
 * first, so that any port opens and any preview closes. Each open gets a new
 * preview ID, so a port opens again after a revoke. `hold` can keep a
 * terminal read from its answer.
 */
export function devFetch(
  server: FakeApiServer,
  log: (request: DevRequest) => void,
  hold: DevHold,
): ApiFetch {
  const previews = previewsPath(FAKE_IDS.org, FAKE_IDS.workspace)
  const terminal = terminalPaths.connection(FAKE_IDS.org, FAKE_IDS.workspace)
  return async (path, init) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : ''
    const port = requestedPort(body)
    if (method === 'POST' && path === previews && port !== null) {
      opens += 1
      const preview = devPreview(`opened-${opens}`, port)
      server.json('POST', path, { preview }, 201)
    }
    if (method === 'DELETE' && path.startsWith(`${previews}/`)) {
      server.empty('DELETE', path)
    }
    const response = await server.fetch(path, init)
    const held = method === 'GET' && path === terminal ? hold.wait() : null
    if (held) await held
    log({ method, path, body, status: response.status })
    return response
  }
}

/** Delivers the fake events, history first, as the shell's reader would. */
export function devSubscribe(server: FakeApiServer): SubscribeWorkspaceEvents {
  return (listener) =>
    server.events.subscribe(0, (message) => {
      if (message.type === 'event') listener(message.envelope)
      else message.history.events.forEach(listener)
    })
}

/** Sends one live event of a workspace through the fake events. */
export function emitDevEvent(
  server: FakeApiServer,
  workspaceId: string,
  event: WorkspaceEvent,
): void {
  server.events.emit({
    workspaceId,
    eventNumber: server.events.history().throughEventNumber + 1,
    occurredAt: FAKE_TIME,
    event,
  })
}

/** The event that says that the sandbox of the workspace runs. */
export function sandboxReadyEvent(): WorkspaceEvent {
  return {
    type: 'workspace.updated',
    workspace: workspaceFixtures().detail.workspace,
  }
}
