import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import type { StartStep } from '../../shared/generated/StartStep'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import type { ChatEvent } from '../../shared/chat-events'
import type { WorkspaceEvent } from '../../shared/events'
import { readGitHubSummary } from '../../shared/github-read'
import type { OrderedWorkspaceResponse } from '../../shared/workspaces'
import { count, isRecord, list, nullable, oneOf, record, text } from './json'
import { readChatEvent, readChoice, readSender } from './read-chat'

/**
 * The workspace events that the chat reads. The stream also carries file,
 * GitHub, and preview events. Those only move the stream cursor on.
 */
type ChatStreamEvent =
  | ChatEvent
  | Extract<
      WorkspaceEvent,
      { type: 'workspace.updated' | 'workspace.title' | 'start.updated' }
    >

/** An envelope of the workspace stream. `event` is null for other events. */
export interface StreamEnvelope {
  workspaceId: string
  eventNumber: number
  occurredAt: number
  event: ChatStreamEvent | null
  /** The workspace marked an agent event of a turn that had ended. */
  late: boolean
}

/**
 * One page of stored events. The pages of one read can leave out the numbers
 * of events that a later event of the same read replaces.
 */
export interface StoredEvents {
  envelopes: readonly StreamEnvelope[]
  /** All pages of one read together hold the state through this number. */
  throughEventNumber: number
  /** Where the next page of the same read starts, or null on the final page. */
  nextAfterEventNumber: number | null
}

export interface NewestStoredEvents {
  envelopes: readonly StreamEnvelope[]
  throughEventNumber: number
  nextBeforeEventNumber: number | null
}

export type StreamMessage =
  | { type: 'history'; history: StoredEvents }
  | { type: 'event'; envelope: StreamEnvelope }

const readState = oneOf<WorkspaceState>({
  working: true,
  input: true,
  unread: true,
  ready: true,
  starting: true,
  stopped: true,
  error: true,
  archived: true,
})

function readWorkspace(value: unknown): Workspace {
  const source = record(value, 'workspace')
  return {
    id: text(source.id),
    number: count(source.number),
    link: text(source.link),
    orgId: text(source.orgId),
    repositoryId: text(source.repositoryId),
    sectionId: text(source.sectionId),
    owner: readSender(source.owner),
    name: nullable(text)(source.name),
    branch: text(source.branch),
    choice: readChoice(source.choice),
    state: readState(source.state),
    github: readGitHubSummary(source.github),
    createdAt: count(source.createdAt),
    updatedAt: count(source.updatedAt),
    archivedAt: nullable(count)(source.archivedAt),
    restoreUntil: nullable(count)(source.restoreUntil),
  }
}

function readStep(value: unknown): StartStep {
  const source = record(value, 'step')
  return {
    id: text(source.id),
    label: text(source.label),
    state: oneOf<StartStep['state']>({
      running: true,
      completed: true,
      failed: true,
    })(source.state),
    startedAt: count(source.startedAt),
    completedAt: nullable(count)(source.completedAt),
  }
}

function readStart(value: unknown): WorkspaceStart {
  const source = record(value, 'start')
  return {
    kind: oneOf<WorkspaceStart['kind']>({ create: true, resume: true })(
      source.kind,
    ),
    startedAt: count(source.startedAt),
    steps: list(readStep)(source.steps),
  }
}

/** A read or a Resume reply, with the event number of its state. */
export function readWorkspaceResponse(
  value: unknown,
): OrderedWorkspaceResponse {
  const source = record(value, 'workspace response')
  return {
    eventNumber: count(source.eventNumber),
    workspace: readWorkspace(source.workspace),
    start: nullable(readStart)(source.start),
    error: nullable((error) => {
      const fields = record(error, 'error')
      return {
        code: text(fields.code),
        message: text(fields.message),
        log: nullable(text)(fields.log),
      }
    })(source.error),
  }
}

/** The saved public error of an update. Its absence keeps the saved one. */
function readUpdateError(value: unknown) {
  const fields = record(value, 'error')
  return { code: text(fields.code), message: text(fields.message) }
}

function readEvent(value: unknown): ChatStreamEvent | null {
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'workspace.updated':
      return {
        type: value.type,
        workspace: readWorkspace(value.workspace),
        ...(value.error === undefined
          ? {}
          : { error: nullable(readUpdateError)(value.error) }),
      }
    case 'workspace.title':
      return { type: value.type, name: text(value.name) }
    case 'start.updated':
      return { type: value.type, start: readStart(value.start) }
    default:
      return readChatEvent(value)
  }
}

/**
 * Reads one envelope. An event that this app does not read, or cannot read,
 * keeps its number, so the cursor still moves past it.
 */
export function readEnvelope(value: unknown): StreamEnvelope {
  const source = record(value, 'envelope')
  let event: ChatStreamEvent | null
  try {
    event = readEvent(source.event)
  } catch {
    event = null
  }
  return {
    workspaceId: text(source.workspaceId),
    eventNumber: count(source.eventNumber),
    occurredAt: count(source.occurredAt),
    event,
    // Only the value true is the mark of the workspace.
    late: source.late === true,
  }
}

export function readStoredEvents(value: unknown): StoredEvents {
  const source = record(value, 'history')
  return {
    envelopes: list(readEnvelope)(source.events),
    throughEventNumber: count(source.throughEventNumber),
    nextAfterEventNumber:
      source.hasMore === true ? count(source.nextAfterEventNumber) : null,
  }
}

export function readNewestStoredEvents(value: unknown): NewestStoredEvents {
  const source = record(value, 'history')
  return {
    envelopes: list(readEnvelope)(source.events),
    throughEventNumber: count(source.throughEventNumber),
    nextBeforeEventNumber:
      source.hasMore === true ? count(source.nextBeforeEventNumber) : null,
  }
}

/** Reads one message of the workspace stream, or null when it is unreadable. */
export function readStreamMessage(value: unknown): StreamMessage | null {
  try {
    const source = record(value, 'message')
    if (source.type === 'history') {
      return { type: 'history', history: readStoredEvents(source.history) }
    }
    if (source.type === 'event') {
      return { type: 'event', envelope: readEnvelope(source.envelope) }
    }
    return null
  } catch {
    return null
  }
}
