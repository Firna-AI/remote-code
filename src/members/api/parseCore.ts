import type { Workspace } from '../../shared/generated/Workspace'
import type { WorkspaceState } from '../../shared/generated/WorkspaceState'
import type { Agent } from '../../shared/generated/Agent'
import type { AgentChoice } from '../../shared/generated/AgentChoice'
import type { Effort } from '../../shared/generated/Effort'
import type { MessageSender } from '../../shared/generated/MessageSender'
import type { OrgRole, User } from '../../shared/api'
import { readGitHubSummary } from '../../shared/github-read'
import type {
  MembersResponse,
  OrgInvite,
  OrgMember,
} from '../../shared/members'
import type { OrgSummary } from '../../shared/orgs'
import type { WorkspacesResponse } from '../../shared/workspaces'
import {
  count,
  countOrNull,
  list,
  nested,
  object,
  oneOf,
  text,
  textOrNull,
  type JsonObject,
} from './json'

const roles: Readonly<Record<OrgRole, OrgRole>> = {
  admin: 'admin',
  member: 'member',
}
const agents: Readonly<Record<Agent, Agent>> = {
  claude: 'claude',
  codex: 'codex',
}
const efforts: Readonly<Record<Effort, Effort>> = {
  none: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
  ultra: 'ultra',
}
const workspaceStates: Readonly<Record<WorkspaceState, WorkspaceState>> = {
  working: 'working',
  input: 'input',
  unread: 'unread',
  ready: 'ready',
  starting: 'starting',
  stopped: 'stopped',
  error: 'error',
  archived: 'archived',
}

function sender(source: JsonObject): MessageSender {
  return {
    id: text(source, 'id'),
    githubLogin: text(source, 'githubLogin'),
    displayName: textOrNull(source, 'displayName'),
    avatarUrl: textOrNull(source, 'avatarUrl'),
  }
}

function user(source: JsonObject): User {
  return { ...sender(source), githubId: count(source, 'githubId') }
}

export function parseMember(value: unknown): OrgMember {
  const source = object(value, 'member')
  return {
    user: user(nested(source, 'user')),
    role: oneOf(source, 'role', roles),
    joinedAt: count(source, 'joinedAt'),
  }
}

export function parseInvite(value: unknown): OrgInvite {
  const source = object(value, 'invite')
  return {
    id: text(source, 'id'),
    email: text(source, 'email'),
    createdAt: count(source, 'createdAt'),
  }
}

export function parseMembers(value: unknown): MembersResponse {
  const source = object(value, 'members response')
  return {
    members: list(source, 'members', parseMember),
    invites: list(source, 'invites', parseInvite),
  }
}

export function parseOrg(value: unknown): OrgSummary {
  const source = object(value, 'org')
  const org: OrgSummary = {
    id: text(source, 'id'),
    name: text(source, 'name'),
    role: oneOf(source, 'role', roles),
  }
  // Older replies omit the initials, so the org keeps them only when given.
  if (typeof source.initials === 'string') org.initials = source.initials
  if (source.deletion === undefined || source.deletion === null) return org
  const deletion = nested(source, 'deletion')
  return {
    ...org,
    deletion: {
      deletedAt: count(deletion, 'deletedAt'),
      deletesAt: count(deletion, 'deletesAt'),
    },
  }
}

function agentChoice(source: JsonObject): AgentChoice {
  return {
    agent: oneOf(source, 'agent', agents),
    model: text(source, 'model'),
    effort: oneOf(source, 'effort', efforts),
    fast: source.fast === true,
  }
}

export function parseWorkspace(value: unknown): Workspace {
  const source = object(value, 'workspace')
  return {
    id: text(source, 'id'),
    number: count(source, 'number'),
    link: text(source, 'link'),
    orgId: text(source, 'orgId'),
    repositoryId: text(source, 'repositoryId'),
    sectionId: text(source, 'sectionId'),
    owner: sender(nested(source, 'owner')),
    name: textOrNull(source, 'name'),
    branch: text(source, 'branch'),
    choice: agentChoice(nested(source, 'choice')),
    state: oneOf(source, 'state', workspaceStates),
    github: readGitHubSummary(source.github),
    createdAt: count(source, 'createdAt'),
    updatedAt: count(source, 'updatedAt'),
    archivedAt: countOrNull(source, 'archivedAt'),
    restoreUntil: countOrNull(source, 'restoreUntil'),
  }
}

export function parseWorkspaces(value: unknown): WorkspacesResponse {
  const source = object(value, 'workspaces response')
  return { workspaces: list(source, 'workspaces', parseWorkspace) }
}

/** The single record that a response wraps, such as `{ member }`. */
export function field<T>(
  key: string,
  read: (value: unknown) => T,
): (value: unknown) => T {
  return (value) => read(object(value, `${key} response`)[key])
}
