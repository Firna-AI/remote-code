import type { RunnerEvent } from '../../src/shared/generated/RunnerEvent'
import {
  TOOL_DETAIL_MAX_BYTES,
  TURN_COMPLETED_FILES_MAX_BYTES,
  TURN_COMPLETED_MAX_FILES,
} from '../../src/shared/chat-events'
import {
  FILE_EVENT_MAX_BYTES,
  FILE_TREE_DELTA_MAX_CHANGES,
} from '../../src/shared/files'
import { RUNNER_EVENT_MAX_BYTES } from '../../src/shared/runner'
import { jsonBytes } from '../../src/shared/event-limits'
import { HttpError, isRecord } from '../http'
import { invalidInput } from './inputs'

function within(value: unknown, limit: number): void {
  if (jsonBytes(value) > limit) tooLarge()
}

function tooLarge(): never {
  throw new HttpError(
    400,
    'runner_event_too_large',
    'The runner event is too large.',
  )
}

/** Measure the raw envelope before copying only its known contract fields. */
export function checkRunnerEnvelopeBytes(value: unknown): void {
  within(value, RUNNER_EVENT_MAX_BYTES)
  if (!isRecord(value) || !isRecord(value.event)) return
  if (
    value.event.type === 'files.snapshot' ||
    value.event.type === 'files.changed' ||
    value.event.type === 'changes.updated'
  )
    within(value.event, FILE_EVENT_MAX_BYTES)
  if (value.event.type === 'turn.completed' && Array.isArray(value.event.files))
    within(value.event.files, TURN_COMPLETED_FILES_MAX_BYTES)
}

export function checkRunnerEventLimits(event: RunnerEvent): void {
  if (event.type === 'tool.updated') {
    if (event.tool.detail === null && event.tool.omittedDetailBytes !== 0)
      invalidInput()
    if (event.tool.detail !== null)
      within(event.tool.detail, TOOL_DETAIL_MAX_BYTES)
  } else if (event.type === 'turn.completed') {
    if (event.files.length > TURN_COMPLETED_MAX_FILES) tooLarge()
    within(event.files, TURN_COMPLETED_FILES_MAX_BYTES)
    if (
      new Set(event.files.map((entry) => entry.path)).size !==
      event.files.length
    )
      invalidInput()
  } else if (event.type === 'files.changed') {
    if (event.delta.changes.length > FILE_TREE_DELTA_MAX_CHANGES) tooLarge()
  }
}
