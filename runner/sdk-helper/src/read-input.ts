import type { AgentChoice } from './generated/AgentChoice'
import type { CommitAuthor } from './generated/CommitAuthor'
import type { Attachment } from './generated/Attachment'
import type { UserMessage } from './generated/UserMessage'
import type { RunnerTurnCredential } from './generated/RunnerTurnCredential'
import { array, integer, nullable, object, oneOf, string } from './parse'

export function parseChoice(value: unknown): AgentChoice {
  const input = object(value)
  return {
    agent: oneOf(input.agent, ['claude', 'codex']),
    fast: input.fast === true,
    model: string(input.model),
    effort: oneOf(input.effort, [
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]),
  }
}

export function parseCredential(value: unknown): RunnerTurnCredential {
  const input = object(value)
  const token = string(input.token)
  if (input.agent === 'claude') {
    return {
      agent: 'claude',
      kind: oneOf(input.kind, ['token', 'api-key']),
      token,
      ...(input.promptCacheTtl === '1h' ? { promptCacheTtl: '1h' } : {}),
    }
  }
  if (input.agent === 'codex') {
    const kind = oneOf(input.kind, ['token', 'api-key'])
    if (kind === 'api-key') return { agent: 'codex', kind, token }
    const account = object(input.account)
    return {
      agent: 'codex',
      kind,
      token,
      account: {
        accountId: string(account.accountId),
        email: nullable(account.email),
        planType: nullable(account.planType),
        userId: nullable(account.userId),
      },
    }
  }
  throw new Error('The turn credential type is not supported.')
}

function parseAttachment(value: unknown): Attachment {
  const input = object(value)
  return {
    id: string(input.id),
    name: string(input.name),
    path: nullable(input.path ?? null),
    kind: oneOf(input.kind, ['file', 'image']),
    mediaType: string(input.mediaType),
    sizeBytes: integer(input.sizeBytes),
  }
}

export function parseUserMessage(value: unknown): UserMessage {
  const input = object(value)
  const sender = object(input.sender)
  return {
    id: string(input.id),
    sessionId: string(input.sessionId),
    sender: {
      id: string(sender.id),
      githubLogin: string(sender.githubLogin),
      displayName: nullable(sender.displayName),
      avatarUrl: nullable(sender.avatarUrl),
    },
    text: string(input.text),
    attachments: array(input.attachments, parseAttachment),
    choice: parseChoice(input.choice),
    createdAt: integer(input.createdAt),
    state: oneOf(input.state, ['queued', 'sent']),
  }
}

export function parseCommitAuthor(
  value: unknown,
  warn: (message: string) => void,
): CommitAuthor | null {
  if (value === undefined || value === null) return null
  try {
    const author = object(value)
    return { name: string(author.name), email: string(author.email) }
  } catch {
    warn('The turn commit author is invalid. The sandbox author will be used.')
    return null
  }
}
