import type { AgentCreateWorkspaceResponse } from '../../src/shared/generated/AgentCreateWorkspaceResponse'
import type { MessageSender } from '../../src/shared/generated/MessageSender'
import type { Workspace } from '../../src/shared/generated/Workspace'
import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'
import { readGitHubSummary } from '../../src/shared/github-read'
import { choice, record, text, ToolInputError } from './input'

export function workspaceState(value: unknown): WorkspaceState {
  switch (value) {
    case 'working':
    case 'input':
    case 'unread':
    case 'ready':
    case 'starting':
    case 'stopped':
    case 'error':
    case 'archived':
      return value
    default:
      throw new ToolInputError('The workspace state is not valid.')
  }
}

function nullableText(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new ToolInputError('The workspace reply is not valid.')
}

function timestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new ToolInputError('The workspace reply is not valid.')
}

export function messageSender(value: unknown): MessageSender {
  const fields = record(value)
  return {
    id: text(fields.id),
    githubLogin: text(fields.githubLogin),
    displayName: nullableText(fields.displayName),
    avatarUrl: nullableText(fields.avatarUrl),
  }
}

function workspace(value: unknown): Workspace {
  const fields = record(value)
  return {
    id: text(fields.id),
    number: timestamp(fields.number),
    link: text(fields.link),
    orgId: text(fields.orgId),
    repositoryId: text(fields.repositoryId),
    sectionId: text(fields.sectionId),
    owner: messageSender(fields.owner),
    name: nullableText(fields.name),
    branch: text(fields.branch),
    choice: choice(fields.choice),
    state: workspaceState(fields.state),
    github: readGitHubSummary(fields.github),
    createdAt: timestamp(fields.createdAt),
    updatedAt: timestamp(fields.updatedAt),
    archivedAt:
      fields.archivedAt === null ? null : timestamp(fields.archivedAt),
    restoreUntil:
      fields.restoreUntil === null ? null : timestamp(fields.restoreUntil),
  }
}

export function createdWorkspace(value: unknown): AgentCreateWorkspaceResponse {
  const fields = record(value)
  return {
    workspace: workspace(fields.workspace),
    sessionId: text(fields.sessionId),
    sessionLink: text(fields.sessionLink),
  }
}
