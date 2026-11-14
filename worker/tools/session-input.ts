import type { AgentCreateSessionRequest } from '../../src/shared/generated/AgentCreateSessionRequest'
import type { AgentSendMessageRequest } from '../../src/shared/generated/AgentSendMessageRequest'

import {
  effort,
  identifier,
  invalidInput,
  record,
  string,
} from '../chat/inputs'

function sessionChoice(
  fields: Record<string, unknown>,
): Pick<AgentCreateSessionRequest, 'model' | 'effort' | 'fast' | 'requestId'> {
  const model = fields.model === undefined ? undefined : record(fields.model)
  if (model && model.agent !== 'claude' && model.agent !== 'codex')
    return invalidInput()
  const agent = model?.agent
  return {
    ...(model &&
      (agent === 'claude' || agent === 'codex') && {
        model: { agent, model: identifier(model.model) },
      }),
    ...(fields.effort !== undefined && { effort: effort(fields.effort) }),
    ...(fields.fast !== undefined && { fast: fields.fast === true }),
    ...(fields.requestId !== undefined && {
      requestId: identifier(fields.requestId),
    }),
  }
}

function messageText(value: unknown): string {
  const text = string(value)
  return text.trim() ? text : invalidInput()
}

export function createSessionInput(value: unknown): AgentCreateSessionRequest {
  const fields = record(value)
  return {
    ...sessionChoice(fields),
    ...(typeof fields.title === 'string' && { title: fields.title }),
    ...(fields.firstMessage !== undefined && {
      firstMessage: messageText(fields.firstMessage),
    }),
  }
}

export function sendSessionInput(value: unknown): AgentSendMessageRequest {
  const fields = record(value)
  return { ...sessionChoice(fields), text: messageText(fields.text) }
}
