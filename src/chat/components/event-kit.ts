import type { AgentChatEvent } from '../../shared/generated/AgentChatEvent'
import type { ToolCall } from '../../shared/generated/ToolCall'
import type { ChatEvent, RunnerEventRefused } from '../../shared/chat-events'
import { FAKE_IDS } from '../../test-support/fixtures/core'
import type { ChatController } from '../state/controller'

/** The session and the turn of the recorded chats that the tests extend. */
export const turn = { sessionId: FAKE_IDS.session, turnId: 'turn-1' }

/** The runner stream of the markers, which no line may show. */
export const streamId = 'stream-7f3a'

/** A tool update of the turn, with the output that its detail left out. */
export function update(
  id: string,
  target: string,
  omittedDetailBytes: number,
  state: ToolCall['state'] = 'done',
): AgentChatEvent {
  const tool: ToolCall = {
    id,
    kind: 'run',
    target,
    detail: null,
    omittedDetailBytes,
    state,
  }
  return { ...turn, type: 'tool.updated', tool }
}

/** A whole message of the agent, in the turn unless `turnId` names another. */
export function said(
  messageId: string,
  text: string,
  turnId: string = turn.turnId,
): AgentChatEvent {
  return {
    ...turn,
    turnId,
    type: 'assistant.completed',
    messageId,
    text,
    userMessageIds: [],
  }
}

/** The end of a turn after 4m 12s, with no changed files. */
export function ended(
  state: 'finished' | 'stopped',
  turnId: string = turn.turnId,
): AgentChatEvent {
  return {
    ...turn,
    turnId,
    type: 'turn.completed',
    state,
    durationMs: 252_000,
    files: [],
    omittedFileCount: 0,
    userMessageIds: [],
  }
}

/** A refusal marker of the session, for the turn unless `fields` says. */
export function refused(
  runnerEventNumber: number,
  runnerEventType: RunnerEventRefused['runnerEventType'],
  reason: RunnerEventRefused['reason'],
  fields: Partial<RunnerEventRefused> = {},
): RunnerEventRefused {
  return {
    ...turn,
    type: 'runner.event-refused',
    streamId,
    runnerEventNumber,
    runnerEventType,
    reason,
    ...fields,
  }
}

/** The failure of a turn, which names the message that Try again sends. */
export function failed(
  turnId: string,
  text: string,
  retryMessageId: string,
): AgentChatEvent {
  return {
    ...turn,
    turnId,
    type: 'turn.failed',
    error: { code: 'agent_unavailable', message: text },
    retryMessageId,
    durationMs: 1_000,
  }
}

/**
 * The end of a turn whose changed files the cloud computer could not read:
 * an empty list with the mark, and no omitted files.
 */
export function unreadEnd(
  turnId: string,
  state: 'finished' | 'stopped',
  durationMs = 1_000,
): AgentChatEvent {
  return {
    ...turn,
    turnId,
    type: 'turn.completed',
    state,
    durationMs,
    files: [],
    filesUnavailable: true,
    omittedFileCount: 0,
    userMessageIds: [],
  }
}

/**
 * The record of an open session, as the Worker sends it after a change. It
 * names the message that Try again may send, or null.
 */
export function recordNaming(
  controller: ChatController,
  retryMessageId: string | null,
  sessionId: string = turn.sessionId,
): ChatEvent {
  const session = controller
    .getSnapshot()
    .sessions.find((item) => item.id === sessionId)
  if (!session) throw new Error(`The session ${sessionId} is not open.`)
  return { type: 'session.updated', session: { ...session, retryMessageId } }
}

/** How many times a part shows in a text. */
export const count = (text: string, part: string) => text.split(part).length - 1
