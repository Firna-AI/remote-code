import type { ToolCall } from '../shared/generated/ToolCall'
import type { ChatEvent } from '../shared/chat-events'
import type { WorkspaceEventEnvelope } from '../shared/events'
import { sessionLink } from '../shared/session-link'
import type { TurnStopRequester } from '../shared/session-stop'
import { FAKE_IDS, FAKE_ORIGIN, FAKE_TIME } from './fixtures/core'
import { workspaceFixtures } from './fixtures/workspaces'

export type RecordedChatScenario =
  | 'history'
  | 'running'
  | 'steer'
  | 'interrupted'
  | 'failed'
  | 'queued'
  | 'first-turn'
  | 'omitted-data'
  | 'refused-events'
  | 'sent-by'
  | 'stopped-from'

const { message } = workspaceFixtures()
const turn = { sessionId: FAKE_IDS.session, turnId: 'turn-1' }
const accepted: ChatEvent = { type: 'message.accepted', message }
const started: ChatEvent = {
  ...turn,
  type: 'turn.started',
  senderId: message.sender.id,
  choice: message.choice,
  startedAt: FAKE_TIME,
  messageIds: [message.id],
}
const tool: ToolCall = {
  id: 'read-form',
  kind: 'read',
  target: 'src/app/checkout/AddressForm.tsx',
  detail: null,
  omittedDetailBytes: 0,
  state: 'done',
}
const beginning: readonly ChatEvent[] = [
  accepted,
  started,
  { ...turn, type: 'turn.thinking' },
  {
    ...turn,
    type: 'assistant.delta',
    messageId: 'answer-1',
    text: 'I will check ',
  },
  {
    ...turn,
    type: 'assistant.delta',
    messageId: 'answer-1',
    text: 'the checkout form.',
  },
  { ...turn, type: 'tool.updated', tool: { ...tool, state: 'running' } },
  { ...turn, type: 'tool.updated', tool },
]
const completed: readonly ChatEvent[] = [
  {
    ...turn,
    type: 'assistant.completed',
    messageId: 'answer-1',
    text: 'The checkout form now suggests addresses. Manual entry still works.',
    userMessageIds: [message.id],
  },
  {
    ...turn,
    type: 'turn.completed',
    state: 'finished',
    durationMs: 252_000,
    userMessageIds: [message.id],
    files: [{ path: tool.target, change: 'modified', added: 38, removed: 6 }],
    omittedFileCount: 0,
  },
]

/**
 * A message from an agent tool after the finished turn. It names a closed
 * session with a long title, and its `Sent by:` line names a session of
 * another workspace, so the dev app shows both kinds of session chip.
 */
const sentBy: ChatEvent = {
  type: 'message.accepted',
  message: {
    ...message,
    id: 'sent-by',
    text: [
      `Keep the postcode rule of ${sessionLink(FAKE_ORIGIN, FAKE_IDS.org, FAKE_IDS.workspace, 'postcode')}, and set \`delay: 0\` in the tests of the address form.`,
      '',
      '---',
      `Sent by: ${sessionLink(FAKE_ORIGIN, FAKE_IDS.org, 'fix-cart-flake', 'debounce')}`,
    ].join('\n'),
  },
}

/**
 * The turn up to the tests that a stop cut off, then its stop. `requester`
 * names who asked for the stop: the member who pressed Stop, or the session
 * whose agent stopped the turn with a workspace tool. The record names that
 * session by its IDs, so the chat of each workspace of the fake names it.
 */
function stoppedTurn(requester: TurnStopRequester): readonly ChatEvent[] {
  return [
    ...beginning,
    {
      ...turn,
      type: 'tool.updated',
      tool: {
        ...tool,
        id: 'unit',
        kind: 'run',
        target: 'npm test',
        state: 'stopped',
      },
    },
    { ...turn, type: 'turn.stop-requested', ...requester },
    {
      ...turn,
      type: 'turn.completed',
      state: 'stopped',
      durationMs: 161_000,
      files: [],
      omittedFileCount: 0,
      userMessageIds: [message.id],
    },
  ]
}

const records: Readonly<Record<RecordedChatScenario, readonly ChatEvent[]>> = {
  history: [...beginning, ...completed],
  'sent-by': [...beginning, ...completed, sentBy],
  running: beginning,
  steer: [
    ...beginning,
    {
      type: 'message.accepted',
      message: {
        ...message,
        id: 'steer-1',
        text: 'Also debounce the lookups to 250 ms.',
      },
    },
    { ...turn, type: 'message.sent', messageId: 'steer-1' },
    {
      ...turn,
      type: 'assistant.completed',
      messageId: 'answer-1',
      text: 'The form now suggests addresses and waits 250 ms between lookups.',
      userMessageIds: [message.id, 'steer-1'],
    },
    {
      ...turn,
      type: 'turn.completed',
      state: 'finished',
      durationMs: 270_000,
      files: [],
      omittedFileCount: 0,
      userMessageIds: [message.id, 'steer-1'],
    },
  ],
  interrupted: stoppedTurn({ requestedById: message.sender.id }),
  'stopped-from': stoppedTurn({
    requestedBySession: {
      workspaceId: FAKE_IDS.workspace,
      sessionId: 'debounce',
    },
  }),
  failed: [
    accepted,
    started,
    {
      ...turn,
      type: 'turn.failed',
      error: {
        code: 'agent_unavailable',
        message: 'The agent is busy. Try again.',
      },
      retryMessageId: message.id,
      durationMs: 1_000,
    },
  ],
  queued: [
    { type: 'message.accepted', message: { ...message, state: 'queued' } },
  ],
  'first-turn': beginning.slice(0, 6),
  'omitted-data': [
    accepted,
    started,
    {
      ...turn,
      type: 'tool.updated',
      tool: {
        ...tool,
        id: 'test-output',
        kind: 'run',
        target: 'npm test',
        detail: 'Check "address"\n' + '🙂'.repeat(16_378),
        omittedDetailBytes: 8,
      },
    },
    {
      ...turn,
      type: 'turn.completed',
      state: 'finished',
      durationMs: 252_000,
      files: Array.from({ length: 200 }, (_, index) => ({
        path: `src/generated/address-${index}.ts`,
        change: 'added' as const,
        added: 1,
        removed: 0,
      })),
      omittedFileCount: 3,
      userMessageIds: [message.id],
    },
  ],
  'refused-events': [
    accepted,
    started,
    {
      ...turn,
      type: 'runner.event-refused',
      streamId: 'recorded-stream-1',
      runnerEventNumber: 3,
      runnerEventType: 'tool.updated',
      reason: 'too_large',
    },
    {
      ...turn,
      type: 'runner.event-refused',
      streamId: 'recorded-stream-1',
      runnerEventNumber: 4,
      runnerEventType: 'assistant.delta',
      reason: 'turn_not_active',
    },
    {
      type: 'runner.event-refused',
      streamId: 'recorded-stream-1',
      runnerEventNumber: 5,
      runnerEventType: 'unknown',
      reason: 'invalid',
      sessionId: null,
      turnId: null,
    },
  ],
}

/** Recorded product events. They contain no provider events or credentials. */
export function recordedChatEvents(
  scenario: RecordedChatScenario = 'history',
  workspaceId: string = FAKE_IDS.workspace,
  sessionId: string = FAKE_IDS.session,
): readonly WorkspaceEventEnvelope[] {
  return records[scenario].map((record, index) => {
    const event = structuredClone(record)
    if ('sessionId' in event && event.sessionId !== null)
      event.sessionId = sessionId
    if (event.type === 'message.accepted') event.message.sessionId = sessionId
    return {
      workspaceId,
      eventNumber: index + 1,
      occurredAt: FAKE_TIME + index * 1_000,
      event,
    }
  })
}
