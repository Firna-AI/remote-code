import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { Effort } from '../../src/shared/generated/Effort'
import type {
  MessageDraft,
  SendMessageRequest,
} from '../../src/shared/messages'
import { HttpError, isRecord } from '../http'

export function invalidInput(): never {
  throw new HttpError(400, 'invalid_input', 'Check the message and try again.')
}

export function string(value: unknown): string {
  if (typeof value !== 'string') return invalidInput()
  return value
}

export function identifier(value: unknown): string {
  const result = string(value)
  if (!result) return invalidInput()
  return result
}

export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return invalidInput()
  return value.map(identifier)
}

export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return invalidInput()
  return value
}

export function counter(value: unknown): number {
  const result = number(value)
  if (!Number.isSafeInteger(result)) return invalidInput()
  return result
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return invalidInput()
  return value
}

export function effort(value: unknown): Effort {
  if (
    value === 'none' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max' ||
    value === 'ultra'
  )
    return value
  return invalidInput()
}

export function choice(value: unknown): AgentChoice {
  const input = record(value)
  if (input.agent !== 'claude' && input.agent !== 'codex') return invalidInput()
  return {
    agent: input.agent,
    model: identifier(input.model),
    effort: effort(input.effort),
    fast: input.fast === true,
  }
}

export function draft(value: unknown): MessageDraft {
  const input = record(value)
  return {
    text: string(input.text),
    attachmentIds: strings(input.attachmentIds),
  }
}

export function sendMessage(value: unknown): SendMessageRequest {
  const input = record(value)
  const result = {
    ...draft(input),
    id: identifier(input.id),
    choice: choice(input.choice),
  }
  if (!result.text.trim() && result.attachmentIds.length === 0)
    return invalidInput()
  return result
}
