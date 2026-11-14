import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import {
  readEnvelope,
  readStoredEvents,
} from '../../src/chat/api/read-workspace'
import { chatEventsOf } from '../../src/shared/transcript/session-events'
import { SessionLog } from '../../src/shared/transcript/session-log'
import type {
  ChatHistoryResponse,
  WorkspaceEventEnvelope,
} from './workspace-events'
import { createRunnerLimitsFixture } from './runner-limits.test-support'
import { choice, context } from './runner-fixtures.test-support'
import type { ChatData } from './types'
import { chatKey } from './storage-keys'
export const tool = {
  id: 'first-tool',
  kind: 'run' as const,
  target: 'test',
  detail: null,
  omittedDetailBytes: 0,
}
export async function orderedHistoryFixture() {
  const fixture = await createRunnerLimitsFixture()
  let eventNumber = 0
  const receive = (event: RunnerEvent, occurredAt: number) =>
    fixture.receive(++eventNumber, event, { occurredAt })
  await receive(
    {
      ...context,
      type: 'turn.started',
      senderId: 'sender',
      choice,
      startedAt: 10,
      messageIds: [],
    },
    10,
  )
  await receive(
    {
      ...context,
      type: 'assistant.delta',
      messageId: 'answer',
      text: 'partial-answer-first',
    },
    11,
  )
  await receive(
    {
      ...context,
      type: 'tool.updated',
      tool: { ...tool, state: 'running', detail: 'detail-running-A' },
    },
    12,
  )
  await receive(
    {
      ...context,
      type: 'tool.updated',
      tool: {
        ...tool,
        id: 'second-tool',
        state: 'running',
        detail: 'detail-running-B',
      },
    },
    13,
  )
  for (let part = 0; part < 30; part++)
    await receive(
      {
        type: 'start.updated',
        start: { kind: 'create', startedAt: part, steps: [] },
      },
      13,
    )
  await receive(
    {
      ...context,
      type: 'tool.updated',
      tool: {
        ...tool,
        id: 'second-tool',
        state: 'done',
        detail: 'Final second detail',
      },
    },
    14,
  )
  await receive(
    {
      ...context,
      type: 'assistant.delta',
      messageId: 'answer',
      text: 'partial-answer-next',
    },
    15,
  )
  await receive(
    {
      ...context,
      type: 'tool.updated',
      tool: { ...tool, state: 'running', detail: 'detail-intermediate-A' },
    },
    16,
  )
  await receive(
    {
      ...context,
      type: 'tool.updated',
      tool: { ...tool, state: 'done', detail: 'Final first detail' },
    },
    17,
  )
  await receive(
    {
      ...context,
      type: 'assistant.completed',
      messageId: 'answer',
      text: 'Final answer',
      userMessageIds: [],
    },
    18,
  )
  await receive(
    {
      ...context,
      type: 'turn.completed',
      state: 'finished',
      durationMs: 10,
      files: [],
      omittedFileCount: 0,
      userMessageIds: [],
    },
    20,
  )
  return fixture
}
export async function historyPages(
  fixture: Awaited<ReturnType<typeof createRunnerLimitsFixture>>,
) {
  const pages: ChatHistoryResponse[] = []
  let after = 0
  let through: number | undefined
  while (true) {
    const page = await fixture.read((view) => view.history(after, through))
    pages.push(page)
    through = page.throughEventNumber
    if (!page.hasMore) return pages
    after = page.nextAfterEventNumber
  }
}
export function mergeLive(
  log: SessionLog,
  events: readonly WorkspaceEventEnvelope[],
) {
  log.merge(chatEventsOf('session', events.map(readEnvelope)))
}
export function mergeHistory(log: SessionLog, page: ChatHistoryResponse) {
  log.merge(chatEventsOf('session', readStoredEvents(page).envelopes))
}
export function itemRows(log: SessionLog) {
  const times = log.times
  return log.transcript.items.map((item) => {
    const at = times.get(item.id)
    if (item.kind === 'agent') return { kind: 'answer', text: item.text, at }
    if (item.kind === 'tool')
      return {
        kind: 'tool',
        id: item.tool.id,
        detail: item.tool.detail,
        state: item.tool.state,
        at,
      }
    return { kind: item.kind, at }
  })
}
export async function forgetPositionIndex(storage: ChatData): Promise<void> {
  await storage.delete(chatKey('history-index', 'positions-through'))
  for (const key of (await storage.list({ prefix: '' })).keys())
    if (
      (key.startsWith(chatKey('history-answer', '')) ||
        key.startsWith(chatKey('history-tool', ''))) &&
      key.endsWith(':first')
    )
      await storage.delete(key)
}
