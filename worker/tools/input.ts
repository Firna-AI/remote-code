import type { Agent } from '../../src/shared/generated/Agent'
import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import type { AgentCreateWorkspaceRequest } from '../../src/shared/generated/AgentCreateWorkspaceRequest'
import type { Effort } from '../../src/shared/generated/Effort'

export class ToolInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ToolInputError('Use an object for the workspace request.')
  }
  return value
}

export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolInputError('Complete the required workspace fields.')
  }
  return value
}

function agent(value: unknown): Agent {
  if (value === 'claude' || value === 'codex') return value
  throw new ToolInputError('Choose Claude or Codex for the workspace.')
}

function effort(value: unknown): Effort {
  switch (value) {
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
    case 'ultra':
      return value
    default:
      throw new ToolInputError('Choose a valid effort for the workspace.')
  }
}

export function choice(value: unknown): AgentChoice {
  const fields = record(value)
  return {
    agent: agent(fields.agent),
    model: text(fields.model),
    effort: effort(fields.effort),
    fast: fields.fast === true,
  }
}

export function createWorkspaceInput(
  value: unknown,
): AgentCreateWorkspaceRequest {
  const fields = record(value)
  const model = fields.model === undefined ? undefined : record(fields.model)
  if (
    fields.requestId !== undefined &&
    (typeof fields.requestId !== 'string' || fields.requestId.length === 0)
  )
    throw new ToolInputError('Use a nonempty request ID.')
  return {
    ...(typeof fields.requestId === 'string' && {
      requestId: fields.requestId,
    }),
    ...(typeof fields.firstSessionTitle === 'string' && {
      firstSessionTitle: fields.firstSessionTitle,
    }),
    repositoryId: text(fields.repositoryId),
    firstMessage: text(fields.firstMessage),
    ...(typeof fields.name === 'string' && { name: fields.name }),
    ...(model && {
      model: { agent: agent(model.agent), model: text(model.model) },
    }),
    ...(fields.effort !== undefined && { effort: effort(fields.effort) }),
    ...(fields.fast !== undefined && { fast: fields.fast === true }),
    ...(fields.sectionId !== undefined && {
      sectionId: text(fields.sectionId),
    }),
  }
}
