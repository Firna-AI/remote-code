import type { ListeningPort } from '../../shared/generated/ListeningPort'
import type { WorkspaceEvent } from '../../shared/events'
import type { PortsUpdated } from '../../shared/ports'
import {
  count,
  items,
  maybeNested,
  maybeText,
  nested,
  ParseError,
  record,
  text,
  type JsonObject,
} from './parse'
import { readStart, readWorkspace } from './read-workspaces'

/** The events of a workspace that the shell itself draws. */
export type ShellEvent = Extract<
  WorkspaceEvent,
  { type: 'workspace.updated' | 'start.updated' | 'workspace.title' }
>

/**
 * One numbered event of the stream. `event` keeps the raw payload, so that
 * the chat, the files, and the banner read their own events. `shell` holds
 * the event when the shell draws it.
 */
export interface StreamEnvelope {
  workspaceId: string
  eventNumber: number
  occurredAt: number
  type: string
  event: JsonObject
  shell: ShellEvent | null
  /** The workspace marked an agent event of a turn that had ended. */
  late: boolean
}

export type StreamMessage =
  | {
      type: 'history'
      envelopes: StreamEnvelope[]
      /** All pages of one replay together hold the state through this number. */
      throughEventNumber: number
      /** Where the next page of the replay starts, or null on the final page. */
      nextAfterEventNumber: number | null
    }
  | { type: 'event'; envelope: StreamEnvelope }

function readPublicError(value: unknown) {
  const error = record(value, 'error')
  return { code: text(error, 'code'), message: text(error, 'message') }
}

function readShellEvent(event: JsonObject): ShellEvent | null {
  switch (event.type) {
    case 'workspace.updated':
      return {
        type: 'workspace.updated',
        workspace: nested(event, 'workspace', readWorkspace),
        ...(event.error === undefined
          ? {}
          : { error: maybeNested(event, 'error', readPublicError) }),
      }
    case 'start.updated':
      return { type: 'start.updated', start: nested(event, 'start', readStart) }
    case 'workspace.title':
      return { type: 'workspace.title', name: text(event, 'name') }
    default:
      return null
  }
}

function readListeningPort(value: unknown): ListeningPort {
  const port = record(value, 'port')
  return {
    port: count(port, 'port'),
    name: maybeText(port, 'name'),
    folder: maybeText(port, 'folder'),
  }
}

/**
 * The servers that listen in the sandbox, from the raw payload of a
 * `ports.updated` event. A null list means that the workspace has no
 * current report, such as after a stop.
 */
export function readPortsUpdated(event: JsonObject): PortsUpdated {
  return {
    type: 'ports.updated',
    ports:
      event.ports === null ? null : items(event, 'ports', readListeningPort),
  }
}

export function readEnvelope(value: unknown): StreamEnvelope {
  const envelope = record(value, 'envelope')
  const event = record(envelope.event, 'event')
  return {
    workspaceId: text(envelope, 'workspaceId'),
    eventNumber: count(envelope, 'eventNumber'),
    occurredAt: count(envelope, 'occurredAt'),
    type: text(event, 'type'),
    event,
    shell: readShellEvent(event),
    // Only the value true is the mark of the workspace.
    late: envelope.late === true,
  }
}

export function readStreamMessage(value: unknown): StreamMessage {
  const message = record(value, 'socket message')
  if (message.type === 'history') {
    const history = record(message.history, 'history')
    return {
      type: 'history',
      envelopes: items(history, 'events', readEnvelope),
      throughEventNumber: count(history, 'throughEventNumber'),
      nextAfterEventNumber:
        history.hasMore === true
          ? count(history, 'nextAfterEventNumber')
          : null,
    }
  }
  if (message.type === 'event') {
    return { type: 'event', envelope: readEnvelope(message.envelope) }
  }
  throw new ParseError('The socket sent a message of an unknown type.')
}
