import type { Workspace } from '../../shared/generated/Workspace'
import type { EmptyRequest } from '../../shared/api'
import {
  invitePath,
  invitesPath,
  memberPath,
  membersPath,
  workspaceOwnerPath,
  type ChangeMemberRoleRequest,
  type InviteMemberRequest,
  type MembersResponse,
  type OrgInvite,
  type OrgMember,
  type ReassignWorkspaceRequest,
} from '../../shared/members'
import {
  buildPath,
  orgSettingsPaths,
  type BuildResponse,
  type BuildsResponse,
  type OrgSettings,
  type RepositoriesResponse,
} from '../../shared/org-settings'
import {
  deleteOrgPath,
  restoreOrgPath,
  type DeleteOrgRequest,
  type OrgSummary,
} from '../../shared/orgs'
import {
  workspacesPath,
  type WorkspacesResponse,
} from '../../shared/workspaces'
import { isObject, ResponseShapeError } from './json'
import {
  field,
  parseInvite,
  parseMember,
  parseMembers,
  parseOrg,
  parseWorkspace,
  parseWorkspaces,
} from './parseCore'
import {
  parseBuild,
  parseBuilds,
  parseRepositories,
  parseSettings,
} from './parseSettings'

/** The browser's `fetch`, or a fake with the same shape. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** A failed request, with the code and the user-facing message of the API. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

const REQUEST_FAILED = 'The request failed. Try again.'
const NETWORK_FAILED =
  'The app cannot reach the server. Check the connection, then try again.'

/** The message to show for a failed request. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : REQUEST_FAILED
}

/** The calls of the members UI. Each one rejects with `ApiRequestError`. */
export interface MembersApi {
  members(orgId: string): Promise<MembersResponse>
  workspaces(orgId: string): Promise<WorkspacesResponse>
  invite(orgId: string, request: InviteMemberRequest): Promise<OrgInvite>
  cancelInvite(orgId: string, inviteId: string): Promise<void>
  changeRole(
    orgId: string,
    userId: string,
    request: ChangeMemberRoleRequest,
  ): Promise<OrgMember>
  removeMember(orgId: string, userId: string): Promise<void>
  reassignWorkspace(
    orgId: string,
    workspaceId: string,
    request: ReassignWorkspaceRequest,
  ): Promise<Workspace>
  deleteOrg(orgId: string, request: DeleteOrgRequest): Promise<OrgSummary>
  restoreOrg(orgId: string): Promise<OrgSummary>
  repositories(orgId: string): Promise<RepositoriesResponse>
  settings(orgId: string): Promise<OrgSettings>
  builds(orgId: string): Promise<BuildsResponse>
  build(orgId: string, buildId: string): Promise<BuildResponse>
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** The app gate takes every write as a JSON object, also a DELETE. */
const empty: EmptyRequest = {}

async function failure(response: Response): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const detail = isObject(body) && isObject(body.error) ? body.error : null
  if (typeof detail?.code === 'string' && typeof detail.message === 'string') {
    return new ApiRequestError(response.status, detail.code, detail.message)
  }
  return new ApiRequestError(response.status, 'request_failed', REQUEST_FAILED)
}

async function read<T>(
  response: Response,
  parse: (value: unknown) => T,
): Promise<T> {
  try {
    const value: unknown = await response.json()
    return parse(value)
  } catch (error) {
    if (error instanceof ResponseShapeError || error instanceof SyntaxError) {
      throw new ApiRequestError(
        response.status,
        'invalid_response',
        REQUEST_FAILED,
      )
    }
    throw error
  }
}

/**
 * The client of the members UI. `fetch` is the browser's `fetch` in the
 * app, and `FakeApiServer.fetch` in development and tests.
 */
export function createMembersApi(fetch: FetchLike): MembersApi {
  async function exchange(method: Method, path: string, body?: object) {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let response: Response
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiRequestError(0, 'network_error', NETWORK_FAILED)
    }
    if (!response.ok) throw await failure(response)
    return response
  }
  async function get<T>(path: string, parse: (value: unknown) => T) {
    return read(await exchange('GET', path), parse)
  }
  async function write<T>(
    method: Method,
    path: string,
    body: object,
    parse: (value: unknown) => T,
  ) {
    return read(await exchange(method, path, body), parse)
  }
  async function command(method: Method, path: string) {
    await exchange(method, path, empty)
  }
  return {
    members: (orgId) => get(membersPath(orgId), parseMembers),
    workspaces: (orgId) => get(workspacesPath(orgId), parseWorkspaces),
    invite: (orgId, request) =>
      write('POST', invitesPath(orgId), request, field('invite', parseInvite)),
    cancelInvite: (orgId, inviteId) =>
      command('DELETE', invitePath(orgId, inviteId)),
    changeRole: (orgId, userId, request) =>
      write(
        'PATCH',
        memberPath(orgId, userId),
        request,
        field('member', parseMember),
      ),
    removeMember: (orgId, userId) =>
      command('DELETE', memberPath(orgId, userId)),
    reassignWorkspace: (orgId, workspaceId, request) =>
      write(
        'PUT',
        workspaceOwnerPath(orgId, workspaceId),
        request,
        field('workspace', parseWorkspace),
      ),
    deleteOrg: (orgId, request) =>
      write('POST', deleteOrgPath(orgId), request, field('org', parseOrg)),
    restoreOrg: (orgId) =>
      write('POST', restoreOrgPath(orgId), empty, field('org', parseOrg)),
    repositories: (orgId) =>
      get(orgSettingsPaths.repositories(orgId), parseRepositories),
    settings: (orgId) => get(orgSettingsPaths.settings(orgId), parseSettings),
    builds: (orgId) => get(orgSettingsPaths.builds(orgId), parseBuilds),
    build: (orgId, buildId) => get(buildPath(orgId, buildId), parseBuild),
  }
}
