import { readTurnSpeed } from '../../../src/shared/chat-events'
import type { HelperOutput } from './generated/HelperOutput'
import type { ProviderEvent } from './generated/ProviderEvent'
import {
  array,
  boolean,
  integer,
  nullable,
  object,
  oneOf,
  string,
} from './parse'

function event(value: unknown): ProviderEvent {
  const input = object(value)
  switch (input.type) {
    case 'conversation':
      return { type: input.type, id: string(input.id) }
    case 'thinking':
      return { type: input.type }
    case 'speed': {
      const speed = readTurnSpeed(input.speed)
      if (!speed) throw new Error('The helper speed is invalid.')
      return { type: input.type, speed }
    }
    case 'delta':
      return {
        type: input.type,
        messageId: string(input.messageId),
        text: string(input.text),
      }
    case 'answer':
      return {
        type: input.type,
        messageId: string(input.messageId),
        text: string(input.text),
        userMessageIds: array(input.userMessageIds, string),
      }
    case 'tool': {
      const tool = object(input.tool)
      return {
        type: input.type,
        tool: {
          id: string(tool.id),
          kind: oneOf(tool.kind, [
            'read',
            'search',
            'create',
            'edit',
            'run',
            'computer',
            'other',
          ]),
          target: string(tool.target),
          detail: nullable(tool.detail),
          omittedDetailBytes: integer(tool.omittedDetailBytes),
          state: oneOf(tool.state, ['running', 'done', 'stopped', 'failed']),
        },
      }
    }
    case 'background':
      return {
        type: input.type,
        live: boolean(input.live),
        idle: boolean(input.idle),
      }
    case 'activity':
      return { type: input.type, idle: boolean(input.idle) }
    case 'wake-up':
      return {
        type: input.type,
        state: oneOf(input.state, ['finished', 'stopped']),
      }
    case 'result':
      return {
        type: input.type,
        state: oneOf(input.state, ['finished', 'stopped']),
        userMessageIds: array(input.userMessageIds, string),
        ...(input.endReason === undefined
          ? {}
          : { endReason: oneOf(input.endReason, ['background_work_limit']) }),
      }
    case 'failed':
      return {
        type: input.type,
        code: string(input.code),
        message: string(input.message),
      }
    default:
      throw new Error('The helper event is invalid.')
  }
}

export function readOutput(value: unknown): HelperOutput {
  const input = object(value)
  switch (input.type) {
    case 'event':
      return { type: input.type, event: event(input.event) }
    case 'response':
      return {
        type: input.type,
        requestId: string(input.requestId),
        result:
          input.result === null
            ? null
            : oneOf(input.result, ['applied', 'deferred']),
      }
    case 'error':
      return {
        type: input.type,
        requestId: string(input.requestId),
        code: string(input.code),
        message: string(input.message),
      }
    case 'warning':
      return { type: input.type, message: string(input.message) }
    case 'background.notes':
      return { type: input.type, ids: array(input.ids, string) }
    case 'exit':
      return { type: input.type }
    default:
      throw new Error('The helper output is invalid.')
  }
}
