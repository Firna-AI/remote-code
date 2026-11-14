import type { WorkspaceToRunner } from '../../../src/shared/generated/WorkspaceToRunner'
import { readRequest } from '../../../runner/sdk-helper/src/read-request'
import { parseChoice } from '../../../runner/sdk-helper/src/read-input'
import {
  integer,
  object,
  oneOf,
  string,
} from '../../../runner/sdk-helper/src/parse'
import { RUNNER_PROTOCOL_VERSION } from '../../../src/shared/runner'

export function readBrowserRunnerMessage(
  value: unknown,
  warn: (message: string) => void,
): WorkspaceToRunner {
  const input = object(value)
  switch (input.type) {
    case 'welcome':
      if (input.protocolVersion !== RUNNER_PROTOCOL_VERSION)
        throw new Error('The fake runner received an unsupported welcome.')
      return {
        type: 'welcome',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        streamId: string(input.streamId),
        confirmedThrough: integer(input.confirmedThrough),
      }
    case 'confirm':
      return {
        type: 'confirm',
        streamId: string(input.streamId),
        throughEventNumber: integer(input.throughEventNumber),
      }
    case 'resend':
      return {
        type: 'resend',
        streamId: string(input.streamId),
        fromEventNumber: integer(input.fromEventNumber),
      }
    case 'turn':
    case 'message': {
      const request = readRequest({
        type: 'send',
        requestId: 'browser-fixture',
        input,
      })
      if (request.type !== 'send') throw new Error('Expected fake agent input.')
      return request.input
    }
    case 'interrupt':
      return {
        type: 'interrupt',
        commandId: string(input.commandId),
        sessionId: string(input.sessionId),
        turnId: string(input.turnId),
      }
    case 'model':
      return {
        type: 'model',
        commandId: string(input.commandId),
        sessionId: string(input.sessionId),
        choice: parseChoice(input.choice),
      }
    case 'file.read':
      return {
        type: 'file.read',
        requestId: string(input.requestId),
        path: string(input.path),
        maxBytes: integer(input.maxBytes),
      }
    case 'file.diff':
      return {
        type: 'file.diff',
        requestId: string(input.requestId),
        path: string(input.path),
        defaultBranch: string(input.defaultBranch),
      }
    case 'report.refresh':
      return {
        type: 'report.refresh',
        commandId: string(input.commandId),
        kind: oneOf(input.kind, [
          'files.snapshot',
          'changes.updated',
          'ports.updated',
          'start.updated',
          'workspace.title',
        ]),
      }
    default:
      warn('The fake runner received an unknown command.')
      throw new Error('The fake runner received an unknown command.')
  }
}
