import type { RunnerEventEnvelope } from '../../src/shared/generated/RunnerEventEnvelope'
import type { WorkspaceEventEnvelope } from './workspace-events'
import { HttpError } from '../http'
import { InvalidRunnerReport, RunnerFileReports } from '../files/runner-reports'
import {
  parseRunnerEnvelope,
  parseRunnerOutputEnvelope,
  type IncomingRunnerEnvelope,
} from './runner-input'
import { refuseRunnerEvent } from './runner-refusal'
import type { ChatTransaction } from './store'
import { prepareAgentEvent } from './turn-events'
import { observeRepairPart } from './repair-refusal'
import { storeWorkspaceTitle } from './workspace-title'
import type { ChatDependencies, RunnerWorkspaceRecord } from './types'
/** Only validation errors become permanent refusals. Storage and sends must retry. */
export async function storeRunnerReceipt(
  transaction: ChatTransaction,
  workspace: RunnerWorkspaceRecord,
  message: IncomingRunnerEnvelope,
  dependencies: ChatDependencies,
): Promise<{ ready: boolean; stored: WorkspaceEventEnvelope[] }> {
  const stored: WorkspaceEventEnvelope[] = []
  const { randomId } = dependencies
  let parsed: RunnerEventEnvelope
  try {
    parsed = parseRunnerEnvelope(message)
  } catch (error) {
    await refuseInvalid(transaction, message, error, randomId)
    return { ready: false, stored: [transaction.emitted[0]] }
  }
  const filtered = await dependencies.filterRunnerOutput(
    transaction,
    workspace,
    parsed,
  )
  let ready = false
  let accepted = false
  if (!filtered.events.length && parsed.event.type === 'assistant.delta') {
    try {
      await prepareAgentEvent(
        transaction,
        { ...parsed.event, text: '' },
        parsed.occurredAt,
        randomId,
      )
      accepted = true
    } catch (error) {
      await refuseSemantic(transaction, message, error, randomId)
      return { ready: false, stored: [transaction.emitted[0]] }
    }
  }
  for (const candidate of filtered.events) {
    const first = transaction.emitted.length
    let output: RunnerEventEnvelope
    try {
      output = parseRunnerOutputEnvelope(candidate)
    } catch (error) {
      await refuseInvalid(transaction, message, error, randomId)
      stored.push(...transaction.emitted.slice(first))
      break
    }
    const result = await applyRunnerEvent(
      transaction,
      message,
      output,
      randomId,
      dependencies.readAutomaticTitleWorkspace,
    )
    ready ||= result.ready
    accepted ||= result.accepted
    const emitted = transaction.emitted
      .slice(first)
      .find(
        (envelope) =>
          envelope.event.type === output.event.type ||
          envelope.event.type === 'runner.event-refused',
      )
    if (emitted) stored.push(emitted)
    if (!result.accepted) break
  }
  if (accepted) await filtered.save()
  return { ready, stored }
}

async function refuseInvalid(
  transaction: ChatTransaction,
  message: IncomingRunnerEnvelope,
  error: unknown,
  randomId: () => string,
) {
  if (
    !(error instanceof HttpError) ||
    (error.code !== 'invalid_input' && error.code !== 'runner_event_too_large')
  )
    throw error
  await refuseRunnerEvent(
    transaction,
    message,
    error.code === 'runner_event_too_large' ? 'too_large' : 'invalid',
    randomId,
  )
}

async function refuseSemantic(
  transaction: ChatTransaction,
  message: IncomingRunnerEnvelope,
  error: unknown,
  randomId: () => string,
) {
  if (!(error instanceof HttpError)) throw error
  const inactive =
    error.code === 'runner_turn_mismatch' || error.code === 'session_not_found'
  if (
    !inactive &&
    error.code !== 'runner_sender_mismatch' &&
    error.code !== 'runner_message_mismatch' &&
    error.code !== 'session_agent_mismatch'
  )
    throw error
  await refuseRunnerEvent(
    transaction,
    message,
    inactive ? 'turn_not_active' : 'invalid',
    randomId,
  )
}

async function applyRunnerEvent(
  transaction: ChatTransaction,
  message: IncomingRunnerEnvelope,
  parsed: RunnerEventEnvelope,
  randomId: () => string,
  readWorkspace: ChatDependencies['readAutomaticTitleWorkspace'],
): Promise<{ ready: boolean; accepted: boolean }> {
  const event = parsed.event
  let apply: (() => Promise<void>) | undefined
  if ('sessionId' in event) {
    try {
      apply = await prepareAgentEvent(
        transaction,
        event,
        parsed.occurredAt,
        randomId,
      )
    } catch (error) {
      await refuseSemantic(transaction, message, error, randomId)
      return { ready: false, accepted: false }
    }
  }
  if (event.type === 'runner.ready') {
    await transaction.saveStreamReady(message.streamId)
    return { ready: true, accepted: true }
  }
  if (
    event.type === 'files.snapshot' ||
    event.type === 'files.unavailable' ||
    event.type === 'files.changed' ||
    event.type === 'changes.updated'
  ) {
    try {
      const complete = await new RunnerFileReports(transaction.files).accept(
        event,
      )
      if (complete) {
        await transaction.emit(complete, parsed.occurredAt)
        if (
          complete.type === 'files.snapshot' ||
          complete.type === 'changes.updated'
        )
          await transaction.repairs.remove(complete.type)
      } else await observeRepairPart(transaction, message.streamId, event)
    } catch (error) {
      if (!(error instanceof InvalidRunnerReport)) throw error
      await refuseRunnerEvent(transaction, message, 'invalid', randomId)
      return { ready: false, accepted: false }
    }
  } else if (apply) {
    await apply()
  } else if (!('sessionId' in event)) {
    if (event.type === 'workspace.title')
      await storeWorkspaceTitle(
        transaction,
        event,
        readWorkspace,
        parsed.occurredAt,
      )
    else await transaction.emit(event, parsed.occurredAt)
    if (event.type === 'start.updated' || event.type === 'ports.updated')
      await transaction.repairs.remove(event.type)
  }
  return { ready: false, accepted: true }
}
