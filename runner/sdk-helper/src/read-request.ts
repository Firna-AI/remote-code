import type { HelperOptions } from './generated/HelperOptions'
import type { HelperRequest } from './generated/HelperRequest'
import type { HelperCredential } from './generated/HelperCredential'
import type { ProviderInput } from './generated/ProviderInput'
import type { RunnerBranches } from './generated/RunnerBranches'
import { array, nullable, object, oneOf, string } from './parse'
import {
  parseChoice,
  parseCredential,
  parseCommitAuthor,
  parseUserMessage,
} from './read-input'

function branches(value: unknown): RunnerBranches {
  const input = object(value)
  return {
    workspaceBranch: string(input.workspaceBranch),
    targetBranch: string(input.targetBranch),
  }
}

function credential(value: unknown): HelperCredential {
  const input = object(value)
  if (input.type === 'gateway')
    return { type: 'gateway', ...parseCredential(input) }
  if (input.type === 'native') {
    const login = object(input.login)
    return {
      type: 'native',
      login: {
        agent: oneOf(login.agent, ['claude', 'codex']),
        kind: oneOf(login.kind, ['token', 'api-key']),
        secret: string(login.secret),
      },
    }
  }
  throw new Error('The helper credential is invalid.')
}

function options(value: unknown): HelperOptions {
  const input = object(value)
  const tools = object(input.tools)
  return {
    cwd: string(input.cwd),
    home: string(input.home),
    sessionId: string(input.sessionId),
    endpoint: string(input.endpoint),
    credential: credential(input.credential),
    commitAuthor: parseCommitAuthor(input.commitAuthor, () => {}),
    choice: parseChoice(input.choice),
    conversationId: nullable(input.conversationId),
    instructions: string(input.instructions),
    ...(input.instructionBranches === undefined
      ? {}
      : {
          instructionBranches:
            input.instructionBranches === null
              ? null
              : branches(input.instructionBranches),
        }),
    tools: {
      machineOrigin: string(tools.machineOrigin),
      workspaceToken: string(tools.workspaceToken),
      turnId: string(tools.turnId),
    },
    backgroundNoteIds: array(input.backgroundNoteIds, string),
  }
}

function providerInput(value: unknown): ProviderInput {
  const input = object(value)
  const command = {
    commandId: string(input.commandId),
    sessionId: string(input.sessionId),
    turnId: string(input.turnId),
    message: parseUserMessage(input.message),
    attachments: array(input.attachments, (value) => {
      const file = object(value)
      return {
        attachmentId: string(file.attachmentId),
        path: string(file.path),
      }
    }),
    ...(input.branches === undefined
      ? {}
      : { branches: branches(input.branches) }),
  }
  if (input.type === 'message') return { ...command, type: 'message' }
  if (input.type === 'turn')
    return {
      ...command,
      type: 'turn',
      credential: parseCredential(input.credential),
      commitAuthor: parseCommitAuthor(input.commitAuthor, () => {}),
    }
  throw new Error('The helper input is invalid.')
}

export function readRequest(value: unknown): HelperRequest {
  const input = object(value)
  const requestId = string(input.requestId)
  switch (input.type) {
    case 'start':
      return { type: 'start', requestId, options: options(input.options) }
    case 'send':
      return { type: 'send', requestId, input: providerInput(input.input) }
    case 'model':
      return { type: 'model', requestId, choice: parseChoice(input.choice) }
    case 'interrupt':
    case 'close':
    case 'warm':
      return { type: input.type, requestId }
    default:
      throw new Error('The helper request is invalid.')
  }
}
