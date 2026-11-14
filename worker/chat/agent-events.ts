import type { AgentChatEvent } from '../../src/shared/generated/AgentChatEvent'
import type { ToolCall } from '../../src/shared/generated/ToolCall'
import type { ChangedFile } from '../../src/shared/generated/ChangedFile'
import type { ChangeKind } from '../../src/shared/generated/ChangeKind'
import { readTurnSpeed } from '../../src/shared/chat-events'
import { warnWorker } from '../warnings'
import {
  choice,
  counter,
  identifier,
  invalidInput,
  number,
  record,
  string,
  strings,
} from './inputs'

function changeKind(value: unknown): ChangeKind {
  if (
    value === 'added' ||
    value === 'modified' ||
    value === 'deleted' ||
    value === 'renamed' ||
    value === 'untracked'
  )
    return value
  return invalidInput()
}

function changedFile(value: unknown): ChangedFile {
  const input = record(value)
  return {
    path: string(input.path),
    ...(typeof input.displayPath === 'string'
      ? { displayPath: input.displayPath }
      : {}),
    change: changeKind(input.change),
    added: number(input.added),
    removed: number(input.removed),
    ...(typeof input.previousDisplayPath === 'string'
      ? { previousDisplayPath: input.previousDisplayPath }
      : {}),
    ...(input.previousPath === undefined
      ? {}
      : { previousPath: string(input.previousPath) }),
  }
}

export function array<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalidInput()
  return value.map(parse)
}

function tool(value: unknown): ToolCall {
  const input = record(value)
  const kind = input.kind
  const state = input.state
  if (
    kind !== 'read' &&
    kind !== 'search' &&
    kind !== 'create' &&
    kind !== 'edit' &&
    kind !== 'run' &&
    kind !== 'computer' &&
    kind !== 'other'
  )
    return invalidInput()
  if (
    state !== 'running' &&
    state !== 'done' &&
    state !== 'stopped' &&
    state !== 'failed'
  )
    return invalidInput()
  return {
    id: identifier(input.id),
    kind,
    target: string(input.target),
    detail: input.detail === null ? null : string(input.detail),
    omittedDetailBytes: counter(input.omittedDetailBytes),
    state,
  }
}

/** Copy only the versioned, provider-neutral fields into durable storage. */
export function parseAgentEvent(value: unknown): AgentChatEvent {
  const input = record(value)
  const context = {
    sessionId: identifier(input.sessionId),
    turnId: identifier(input.turnId),
  }
  switch (input.type) {
    case 'turn.started':
      return {
        ...context,
        type: input.type,
        senderId: identifier(input.senderId),
        choice: choice(input.choice),
        startedAt: number(input.startedAt),
        messageIds: strings(input.messageIds),
      }
    case 'turn.thinking':
      return { ...context, type: input.type }
    case 'assistant.delta':
      return {
        ...context,
        type: input.type,
        messageId: identifier(input.messageId),
        text: string(input.text),
      }
    case 'assistant.completed':
      return {
        ...context,
        type: input.type,
        messageId: identifier(input.messageId),
        text: string(input.text),
        userMessageIds: strings(input.userMessageIds),
      }
    case 'tool.updated':
      return { ...context, type: input.type, tool: tool(input.tool) }
    case 'turn.completed': {
      let speed = readTurnSpeed(input.speed)
      // A turn end is never lost for its speed. An unknown speed counts as
      // standard speed with no known cause.
      if (input.speed !== undefined && !speed) {
        warnWorker({ kind: 'turn_speed_invalid' })
        speed = { state: 'standard' }
      }
      if (input.state !== 'finished' && input.state !== 'stopped')
        return invalidInput()
      return {
        ...context,
        type: input.type,
        state: input.state,
        durationMs: number(input.durationMs),
        ...(speed ? { speed } : {}),
        ...(input.endReason === 'background_work_limit'
          ? { endReason: input.endReason }
          : {}),
        files: array(input.files, changedFile),
        ...(input.filesUnavailable === true ? { filesUnavailable: true } : {}),
        omittedFileCount: counter(input.omittedFileCount),
        userMessageIds: strings(input.userMessageIds),
      }
    }
    case 'turn.failed': {
      const error = record(input.error)
      return {
        ...context,
        type: input.type,
        error: { code: identifier(error.code), message: string(error.message) },
        retryMessageId: identifier(input.retryMessageId),
        durationMs: number(input.durationMs),
      }
    }
    default:
      return invalidInput()
  }
}
