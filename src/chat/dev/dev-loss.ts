import type { AgentChatEvent } from '../../shared/generated/AgentChatEvent'
import type { ToolCall } from '../../shared/generated/ToolCall'
import type { ChangedFile } from '../../shared/generated/ChangedFile'
import type { ChatEvent, RunnerEventRefused } from '../../shared/chat-events'
import type { WorkspaceEventEnvelope } from '../../shared/events'
import { FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'

const { message } = workspaceFixtures()

/** The files of a codemod turn that the runner lists: 200 of its 247. */
const listedFiles: readonly ChangedFile[] = Array.from(
  { length: 200 },
  (_, index): ChangedFile => ({
    path: `src/components/icons/Icon${index + 1}.tsx`,
    change: 'modified',
    added: 1,
    removed: 1,
  }),
)

function run(
  id: string,
  target: string,
  detail: string | null,
  omittedDetailBytes = 0,
): ToolCall {
  return { id, kind: 'run', target, detail, omittedDetailBytes, state: 'done' }
}

/** The events of one turn of a session, from its message to its end. */
function turnOf(sessionId: string, turnId: string) {
  const at = { sessionId, turnId }
  return {
    ask: (text: string): ChatEvent[] => [
      {
        type: 'message.accepted',
        message: { ...message, id: `ask-${turnId}`, sessionId, text },
      },
      {
        ...at,
        type: 'turn.started',
        senderId: message.sender.id,
        choice: message.choice,
        startedAt: FAKE_TIME,
        messageIds: [`ask-${turnId}`],
      },
    ],
    reply: (text: string): AgentChatEvent => ({
      ...at,
      type: 'assistant.completed',
      messageId: `answer-${turnId}`,
      text,
      userMessageIds: [`ask-${turnId}`],
    }),
    tool: (tool: ToolCall): AgentChatEvent => ({
      ...at,
      type: 'tool.updated',
      tool,
    }),
    end: (
      state: 'finished' | 'stopped',
      files: readonly ChangedFile[],
      omittedFileCount: number,
    ): AgentChatEvent => ({
      ...at,
      type: 'turn.completed',
      state,
      durationMs: 186_000,
      files,
      omittedFileCount,
      userMessageIds: [`ask-${turnId}`],
    }),
    refused: (
      runnerEventNumber: number,
      runnerEventType: RunnerEventRefused['runnerEventType'],
      reason: RunnerEventRefused['reason'],
    ): RunnerEventRefused => ({
      ...at,
      type: 'runner.event-refused',
      streamId: 'dev-runner-stream',
      runnerEventNumber,
      runnerEventType,
      reason,
    }),
  }
}

/**
 * The `loss` scenario of the development page: one session with each state
 * of lost or left-out data that a session shows. A codemod lists 200 of its
 * 247 files, a test run left out output, a turn loses two events and stops
 * with files left out, an update of a turn that never started is lost, and
 * the last turn loses its end.
 */
export function lossEvents(
  workspaceId: string,
  sessionId: string,
  viewerId: string,
): WorkspaceEventEnvelope[] {
  const codemod = turnOf(sessionId, 'turn-codemod')
  const suite = turnOf(sessionId, 'turn-suite')
  const profile = turnOf(sessionId, 'turn-profile')
  const spinner = turnOf(sessionId, 'turn-spinner')
  const events: ChatEvent[] = [
    ...codemod.ask('Move every icon import to `@acme/icons`.'),
    codemod.tool(run('codemod', 'npx @acme/icons-codemod src', '247 files')),
    codemod.reply(
      'Done. Every component imports its icons from `@acme/icons`.',
    ),
    codemod.end('finished', listedFiles, 47),
    ...suite.ask('Run the whole test suite before we merge.'),
    suite.tool(run('lint', 'npm run lint', 'passed')),
    suite.tool(run('suite', 'npm test', '312 passed', 1_300_234)),
    suite.reply('All 312 unit tests pass.'),
    suite.end('finished', [], 0),
    ...profile.ask('Profile the checkout page, then speed up the lookups.'),
    profile.refused(31, 'tool.updated', 'too_large'),
    profile.reply('The profile shows a lookup on each key press.'),
    profile.refused(33, 'assistant.delta', 'invalid'),
    profile.tool({
      ...run('unit', 'npm test -- checkout', null),
      state: 'running',
    }),
    {
      sessionId,
      turnId: 'turn-profile',
      type: 'turn.stop-requested',
      requestedById: viewerId,
    },
    profile.end('stopped', [], 5),
    {
      ...profile.refused(36, 'tool.updated', 'turn_not_active'),
      turnId: 'turn-never-started',
    },
    ...spinner.ask('Show a loading state under the address line.'),
    spinner.tool({
      ...run('edit', 'src/AddressForm.tsx', null),
      state: 'running',
    }),
    spinner.refused(38, 'turn.completed', 'invalid'),
  ]
  return events.map((event, index) => ({
    workspaceId,
    eventNumber: index + 1,
    occurredAt: FAKE_TIME + index * 1_000,
    event,
  }))
}

/**
 * The `files=unread` option of the development page: each end of a turn of
 * the recorded chat says that the cloud computer could not read its changed
 * files, so it lists none and leaves none out. The turns still end.
 */
export function withUnreadFiles(
  events: readonly WorkspaceEventEnvelope[],
): WorkspaceEventEnvelope[] {
  return events.map((envelope) =>
    envelope.event.type === 'turn.completed'
      ? {
          ...envelope,
          event: {
            ...envelope.event,
            files: [],
            filesUnavailable: true,
            omittedFileCount: 0,
          },
        }
      : envelope,
  )
}
