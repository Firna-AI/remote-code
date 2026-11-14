import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import type { Attachment } from '../../shared/generated/Attachment'
import type { UserMessage } from '../../shared/generated/UserMessage'
import type { StartStep } from '../../shared/generated/StartStep'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import { readGitHubSummary } from '../../shared/github-read'
import type {
  CreateWorkspaceResponse,
  OrderedWorkspaceResponse,
  WorkspaceResponse,
} from '../../shared/workspaces'
import {
  choice,
  count,
  items,
  maybeCount,
  maybeNested,
  maybeText,
  nested,
  record,
  text,
} from './parse'
import { readChoice, readSender } from './read-core'

export const WORKSPACE_STATES = [
  'working',
  'input',
  'unread',
  'ready',
  'starting',
  'stopped',
  'error',
  'archived',
] as const satisfies readonly WorkspaceState[]

export function readWorkspace(value: unknown): Workspace {
  const workspace = record(value, 'workspace')
  return {
    id: text(workspace, 'id'),
    number: count(workspace, 'number'),
    link: text(workspace, 'link'),
    orgId: text(workspace, 'orgId'),
    repositoryId: text(workspace, 'repositoryId'),
    sectionId: text(workspace, 'sectionId'),
    owner: nested(workspace, 'owner', readSender),
    name: maybeText(workspace, 'name'),
    branch: text(workspace, 'branch'),
    choice: nested(workspace, 'choice', readChoice),
    state: choice(workspace, 'state', WORKSPACE_STATES),
    github: readGitHubSummary(workspace.github),
    createdAt: count(workspace, 'createdAt'),
    updatedAt: count(workspace, 'updatedAt'),
    archivedAt: maybeCount(workspace, 'archivedAt'),
    restoreUntil: maybeCount(workspace, 'restoreUntil'),
  }
}

function readStep(value: unknown): StartStep {
  const step = record(value, 'step')
  return {
    id: text(step, 'id'),
    label: text(step, 'label'),
    state: choice(step, 'state', ['running', 'completed', 'failed']),
    startedAt: count(step, 'startedAt'),
    completedAt: maybeCount(step, 'completedAt'),
  }
}

export function readStart(value: unknown): WorkspaceStart {
  const start = record(value, 'start')
  return {
    kind: choice(start, 'kind', ['create', 'resume']),
    startedAt: count(start, 'startedAt'),
    steps: items(start, 'steps', readStep),
  }
}

export function readWorkspaceResponse(value: unknown): WorkspaceResponse {
  const body = record(value, 'workspace response')
  return {
    workspace: nested(body, 'workspace', readWorkspace),
    start: maybeNested(body, 'start', readStart),
    error: maybeNested(body, 'error', (item) => {
      const error = record(item, 'error')
      return {
        code: text(error, 'code'),
        message: text(error, 'message'),
        log: maybeText(error, 'log'),
      }
    }),
  }
}

/**
 * A read of the workspace or a Resume reply, with the workspace event number
 * whose state it holds. A create, an Archive, and the other writes carry no
 * number, so they read with `readWorkspaceResponse`.
 */
export function readOrderedWorkspaceResponse(
  value: unknown,
): OrderedWorkspaceResponse {
  const body = record(value, 'workspace response')
  return {
    ...readWorkspaceResponse(body),
    eventNumber: count(body, 'eventNumber'),
  }
}

export function readAttachment(value: unknown): Attachment {
  const attachment = record(value, 'attachment')
  return {
    id: text(attachment, 'id'),
    name: text(attachment, 'name'),
    path: maybeText(attachment, 'path'),
    kind: choice(attachment, 'kind', ['image', 'file']),
    mediaType: text(attachment, 'mediaType'),
    sizeBytes: count(attachment, 'sizeBytes'),
  }
}

function readUserMessage(value: unknown): UserMessage {
  const message = record(value, 'message')
  return {
    id: text(message, 'id'),
    sessionId: text(message, 'sessionId'),
    sender: nested(message, 'sender', readSender),
    text: text(message, 'text'),
    attachments: items(message, 'attachments', readAttachment),
    choice: nested(message, 'choice', readChoice),
    createdAt: count(message, 'createdAt'),
    state: choice(message, 'state', ['queued', 'sent']),
  }
}

export function readCreated(value: unknown): CreateWorkspaceResponse {
  const body = record(value, 'created workspace')
  return {
    ...readWorkspaceResponse(value),
    sessionId: text(body, 'sessionId'),
    firstMessage: nested(body, 'firstMessage', readUserMessage),
  }
}

export function readWorkspaces(value: unknown): Workspace[] {
  return items(record(value, 'workspaces'), 'workspaces', readWorkspace)
}
