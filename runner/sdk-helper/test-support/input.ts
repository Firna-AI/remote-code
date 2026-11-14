import type { Agent } from '../src/generated/Agent'
import type { RunnerTurn } from '../src/generated/RunnerTurn'
import type { RunnerMessageDuringTurn } from '../src/generated/RunnerMessageDuringTurn'
import type { RunnerCodexAccount } from '../src/generated/RunnerCodexAccount'

export const fakeToolContext = {
  machineOrigin: 'https://machines.conductive.test',
  workspaceToken: 'workspace-secret',
  turnId: 'turn-1',
}

export const fakeCodexAccount: RunnerCodexAccount = {
  accountId: 'chatgpt-account-alice',
  email: 'alice@example.test',
  planType: 'plus',
  userId: 'chatgpt-user-alice',
}

export function turn(
  id = '1',
  sender = 'alice',
  agent: Agent = 'claude',
): RunnerTurn {
  return {
    type: 'turn',
    commandId: `command-${id}`,
    sessionId: 'session-1',
    turnId: `turn-${id}`,
    message: {
      id: `message-${id}`,
      sessionId: 'session-1',
      sender: {
        id: sender,
        githubLogin: sender,
        displayName: null,
        avatarUrl: null,
      },
      text: 'Change the file.',
      attachments: [],
      choice: { agent, model: 'test-model', effort: 'high', fast: false },
      createdAt: 100,
      state: 'sent',
    },
    attachments: [],
    commitAuthor: null,
    credential:
      agent === 'claude'
        ? { agent, kind: 'token', token: `secret-${sender}` }
        : { agent, kind: 'api-key', token: `secret-${sender}` },
  }
}

export function duringTurn(command: RunnerTurn): RunnerMessageDuringTurn {
  return {
    type: 'message',
    commandId: command.commandId,
    sessionId: command.sessionId,
    turnId: command.turnId,
    message: command.message,
    attachments: command.attachments,
  }
}
