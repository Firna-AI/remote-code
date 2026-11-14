import type { Session } from '../generated/Session'
import type { UserMessage } from '../generated/UserMessage'
import type { ChatEvent } from '../chat-events'

import { fakeMacRequest } from '../../test-support/fixtures/devices'
import { SessionMarkdown, type TranscriptDocument } from './session-markdown'

const oldChoice = {
  agent: 'claude',
  model: 'old',
  effort: 'max',
  fast: false,
} as const
const choice = {
  agent: 'codex',
  model: 'current',
  effort: 'xhigh',
  fast: false,
} as const
const sender = {
  id: 'cal',
  displayName: 'Cal',
  githubLogin: 'cal',
  avatarUrl: null,
}
const session: Session = {
  id: 'session',
  workspaceId: 'workspace',
  title: null,
  choice,
  createdAt: 0,
  closedAt: null,
  activeTurnId: 'live',
  activeTurnStartedAt: 0,
  retryMessageId: null,
  startedBy: sender,
  sourceSessionId: null,
  loginAvailable: true,
  loginShared: true,
}
function message(id: string, text: string): UserMessage {
  return {
    id,
    text,
    sender,
    sessionId: 'session',
    choice,
    attachments: [],
    createdAt: 0,
    state: 'sent',
  }
}
export function markdownFixture() {
  const document: TranscriptDocument = {
    linkContext: { origin: 'https://app.example', orgId: 'org' },
    session,
    eventNumber: 100,
    copiedAt: Date.UTC(2026, 10, 9, 18, 40),
    workspace: {
      number: 395,
      name: null,
      link: 'https://app.example/orgs/org/workspaces/workspace',
    },
    models: [
      { agent: 'claude', model: 'old', label: 'Opus 5.5', efforts: ['max'] },
      {
        agent: 'codex',
        model: 'current',
        label: 'GPT-6.1 Sol',
        efforts: ['xhigh'],
      },
    ],
    members: [sender],
    commands: [
      fakeMacRequest({
        sessionId: 'session',
        turnId: 'finished',
        state: 'completed',
        deviceName: null,
        sender,
        command: "printf '`ready`'\n```",
        folder: '/checkout',
        createdAt: 4500,
        startedAt: 2000,
        updatedAt: 6000,
        result: {
          stdout: 'ok\n```',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          truncated: true,
        },
      }),
    ],
  }
  const turn = (turnId: string) => ({ sessionId: session.id, turnId })
  const events: ChatEvent[] = [
    {
      type: 'message.accepted',
      message: {
        ...message('first', 'Please check.'),
        choice: oldChoice,
        attachments: [
          {
            id: 'file',
            name: 'trace.txt',
            path: null,
            kind: 'file',
            mediaType: 'text/plain',
            sizeBytes: 8,
          },
        ],
      },
    },
    {
      ...turn('finished'),
      type: 'turn.started',
      senderId: 'cal',
      choice: oldChoice,
      startedAt: 0,
      messageIds: ['first'],
    },
    {
      ...turn('finished'),
      type: 'assistant.completed',
      messageId: 'plan',
      text: 'I will check.',
      userMessageIds: [],
    },
    {
      ...turn('finished'),
      type: 'tool.updated',
      tool: {
        id: 'read',
        kind: 'read',
        target: '`src/[redacted].ts`',
        detail: 'Read the file.',
        omittedDetailBytes: 1024,
        state: 'done',
      },
    },
    {
      ...turn('finished'),
      type: 'runner.event-refused',
      streamId: 'stream',
      runnerEventNumber: 5,
      runnerEventType: 'tool.updated',
      reason: 'too_large',
    },
    {
      ...turn('finished'),
      type: 'assistant.completed',
      messageId: 'answer',
      text: 'Fixed.',
      userMessageIds: ['first'],
    },
    {
      ...turn('finished'),
      type: 'turn.completed',
      state: 'finished',
      durationMs: 61000,
      files: [
        {
          path: 'new/secret.ts',
          displayPath: 'new/[redacted].ts',
          previousPath: 'old/secret.ts',
          previousDisplayPath: 'old/[redacted].ts',
          change: 'renamed',
          added: 1,
          removed: 0,
        },
      ],
      omittedFileCount: 3,
      userMessageIds: ['first'],
    },
    {
      ...turn('done-only'),
      type: 'tool.updated',
      tool: {
        id: 'search',
        kind: 'search',
        target: 'docs',
        detail: null,
        omittedDetailBytes: 0,
        state: 'done',
      },
    },
    {
      type: 'message.accepted',
      message: {
        ...message('stop', 'Stop now.'),
        sender: {
          id: 'priya',
          displayName: null,
          githubLogin: 'priya',
          avatarUrl: null,
        },
      },
    },
    {
      ...turn('stopped'),
      type: 'turn.started',
      senderId: 'priya',
      choice,
      startedAt: 0,
      messageIds: ['stop'],
    },
    {
      ...turn('stopped'),
      type: 'tool.updated',
      tool: {
        id: 'run',
        kind: 'run',
        target: 'npm test',
        detail: null,
        omittedDetailBytes: 0,
        state: 'running',
      },
    },
    { ...turn('stopped'), type: 'turn.stop-requested', requestedById: 'cal' },
    {
      ...turn('stopped'),
      type: 'turn.completed',
      state: 'stopped',
      durationMs: 1,
      files: [],
      omittedFileCount: 2,
      userMessageIds: ['stop'],
    },
    { type: 'message.accepted', message: message('retry', 'Try again.') },
    {
      ...turn('failed'),
      type: 'turn.started',
      senderId: 'cal',
      choice,
      startedAt: 0,
      messageIds: ['retry'],
    },
    {
      ...turn('failed'),
      type: 'turn.failed',
      error: { code: 'busy', message: 'The agent is busy.' },
      retryMessageId: 'retry',
      durationMs: 1,
    },
    { type: 'message.accepted', message: message('live', 'Keep working.') },
    {
      ...turn('live'),
      type: 'turn.started',
      senderId: 'cal',
      choice,
      startedAt: 0,
      messageIds: ['live'],
    },
    {
      ...turn('live'),
      type: 'assistant.delta',
      messageId: 'part',
      text: 'Partway.',
    },
  ]
  const builder = new SessionMarkdown(document)
  builder.merge(
    events.map((event, index) => ({
      event,
      eventNumber: index + 1,
      occurredAt: (index + 1) * 1000,
    })),
  )
  return { builder, document }
}
