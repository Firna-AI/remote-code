import { expect, it } from 'vitest'
import type { AgentChatEvent } from '../generated/AgentChatEvent'
import type { RunnerEventRefused } from '../chat-events'
import {
  readStoredEvents,
  type StreamEnvelope,
} from '../../chat/api/read-workspace'
import { chatEventsOf } from './session-events'
import { SessionLog } from './session-log'
import type { Transcript } from './transcript'

/** The chat line of a refusal marker, at its place in the transcript. */
const lineOf = (event: RunnerEventRefused) =>
  expect.objectContaining({ kind: 'lost', marker: event })

/** The refusal markers that the lines of a transcript hold, in their order. */
const markersOf = (transcript: Transcript) =>
  transcript.items.flatMap((item) =>
    item.kind === 'lost' ? [item.marker] : [],
  )

const turn = { sessionId: 'session-1', turnId: 'turn-1' }
const marker: RunnerEventRefused = {
  ...turn,
  type: 'runner.event-refused',
  streamId: 'runner-stream',
  runnerEventNumber: 2,
  runnerEventType: 'tool.updated',
  reason: 'too_large',
}
const completed: Extract<AgentChatEvent, { type: 'turn.completed' }> = {
  ...turn,
  type: 'turn.completed',
  state: 'finished',
  durationMs: 25,
  files: [],
  omittedFileCount: 3,
  userMessageIds: [],
}

function envelope(
  eventNumber: number,
  event: StreamEnvelope['event'],
): StreamEnvelope {
  return {
    workspaceId: 'workspace-1',
    eventNumber,
    occurredAt: 25,
    event,
    late: false,
  }
}

it('keeps refusal markers and completion counts when older session history refolds', () => {
  const log = new SessionLog()
  const refused = envelope(2, marker)
  log.merge(chatEventsOf(turn.sessionId, [refused]))
  expect(markersOf(log.transcript)).toEqual([marker])
  expect(log.transcript).toMatchObject({
    items: [lineOf(marker)],
    turn: null,
  })

  const tool: AgentChatEvent = {
    ...turn,
    type: 'tool.updated',
    tool: {
      id: 'test-output',
      kind: 'run',
      target: 'npm test',
      detail: 'One result 🙂',
      omittedDetailBytes: 8,
      state: 'running',
    },
  }
  const stopped = {
    ...completed,
    turnId: 'turn-2',
    state: 'stopped' as const,
    omittedFileCount: 5,
  }
  const failed: AgentChatEvent = {
    ...turn,
    turnId: 'turn-3',
    type: 'turn.failed',
    error: { code: 'agent_unavailable', message: 'Try again.' },
    retryMessageId: 'message-3',
    durationMs: 10,
  }
  const olderMarker = {
    ...marker,
    runnerEventNumber: 7,
    reason: 'invalid' as const,
  }
  const newerMarker = { ...marker, runnerEventNumber: 8, turnId: null }
  const later = [
    envelope(3, completed),
    envelope(5, stopped),
    envelope(6, failed),
    envelope(8, newerMarker),
  ]
  log.merge(chatEventsOf(turn.sessionId, later))
  const visible = log.transcript.items
  log.merge(
    chatEventsOf(turn.sessionId, [
      envelope(1, tool),
      envelope(4, {
        ...turn,
        turnId: 'turn-2',
        type: 'turn.stop-requested',
        requestedById: 'member-1',
      }),
      envelope(7, olderMarker),
      refused,
      ...later,
    ]),
  )
  expect(markersOf(log.transcript)).toEqual([marker, olderMarker, newerMarker])
  expect(log.transcript).toMatchObject({
    turnCompletions: { 'turn-1': completed, 'turn-2': stopped },
    turn: null,
    stopRequests: {},
  })
  const refolded = visible.map((item) =>
    item.kind === 'stopped' ? { ...item, by: 'member-1' } : item,
  )
  expect(visible.at(-1)).toEqual(lineOf(newerMarker))
  expect(log.transcript.items).toEqual([
    {
      kind: 'tool',
      id: 'tool:turn-1:test-output',
      turnId: 'turn-1',
      tool: { ...tool.tool, state: 'done' },
    },
    ...refolded.slice(0, -1),
    lineOf(olderMarker),
    ...refolded.slice(-1),
  ])
  expect(log.merge(chatEventsOf(turn.sessionId, [refused, ...later]))).toBe(
    false,
  )
  expect(markersOf(log.transcript)).toEqual([marker, olderMarker, newerMarker])
})

it('routes refusal markers only to their named session, as one line each', () => {
  const other = { ...marker, sessionId: 'session-2', turnId: null }
  const workspace = { ...marker, sessionId: null, turnId: null }
  const { envelopes } = readStoredEvents({
    events: [envelope(1, marker), envelope(2, other), envelope(3, workspace)],
    throughEventNumber: 3,
  })
  const first = new SessionLog()
  const second = new SessionLog()
  first.merge(chatEventsOf('session-1', envelopes))
  second.merge(chatEventsOf('session-2', envelopes))
  expect(markersOf(first.transcript)).toEqual([marker])
  expect(first.transcript).toMatchObject({
    items: [lineOf(marker)],
    turn: null,
  })
  expect(markersOf(second.transcript)).toEqual([other])
  expect(second.transcript).toMatchObject({
    items: [lineOf(other)],
    turn: null,
  })
  expect(chatEventsOf('session-3', envelopes)).toEqual([])
})
