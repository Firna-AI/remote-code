import type { Workspace } from '../../shared/generated/Workspace'
import type { MessageSender } from '../../shared/generated/MessageSender'
import type { SendMessageRequest } from '../../shared/messages'
import {
  workspacesPath,
  type CreateWorkspaceResponse,
} from '../../shared/workspaces'
import { maybeText, nested, record, text, texts } from '../api/parse'
import { readChoice } from '../api/read-core'
import { defaultSection } from '../sections'
import { requireOrg, requireWorkspace, type DevBackend } from './backend'
import { ID, json, requiredText, RouteError, type Route } from './router'
import { routes } from '../router'
import { FAKE_ORIGIN } from '../../test-support/fixtures/core'
import { createPlan, failFirstStart, runStart } from './start-steps'
import { slugify, type OrgState } from './state'

/**
 * The cities that name the branches of new workspaces: Lisbon first, as the
 * branch of the recorded create has it.
 */
const CITIES = ['Lisbon', 'Porto', 'Kyoto', 'Oslo', 'Lima', 'Hobart', 'Tallinn']
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Four random characters, as a branch has after its city. */
function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

/** The city that names the branch of the next new workspace of the org. */
function cityFor(org: OrgState): string {
  return CITIES[org.created.size % CITIES.length]
}

/** A new ID such as `lisbon-7k2q`, which the branch name ends with. */
function newWorkspaceId(org: OrgState, city: string): string {
  const taken = new Set(org.workspaces.map((item) => item.id))
  const base = slugify(city, 'workspace')
  let id = `${base}-${randomSuffix()}`
  while (taken.has(id)) id = `${base}-${randomSuffix()}`
  return id
}

function readFirstMessage(value: unknown): SendMessageRequest {
  const message = record(value, 'firstMessage')
  requiredText(message, 'text')
  return {
    id: requiredText(message, 'id'),
    text: text(message, 'text'),
    attachmentIds: texts(message, 'attachmentIds'),
    choice: nested(message, 'choice', readChoice),
  }
}

/** What a new workspace needs: its repository, its section, and its first message. */
export interface WorkspaceRequest {
  repositoryId: string
  /** The section, or null for General. */
  sectionId: string | null
  first: SendMessageRequest
  /**
   * A first start that fails keeps its workspace in the error state, as
   * the Worker keeps the workspace of a routine run.
   */
  keepFailedStart?: boolean
}

/**
 * Create workspace. The first message makes it, in the section of the
 * request or else in General. It has no name, as in the Worker, and the fake
 * writes no title, as local development has no title model. Its branch is
 * the login of the user, a city, and four random characters. A first message
 * that contains `fail` stands for a cloud computer that did not start: the
 * fake makes nothing, and the app keeps the draft. With `keepFailedStart`,
 * the workspace stays in the error state instead.
 */
export function startWorkspace(
  backend: DevBackend,
  org: OrgState,
  request: WorkspaceRequest,
): CreateWorkspaceResponse {
  const { first, repositoryId } = request
  if (org.currentImageBuildId === null)
    throw new RouteError(
      409,
      'image_required',
      org.builds.some((item) => item.build.state === 'running')
        ? 'The cloud computer is still being prepared.'
        : 'The cloud computer needs a build. Ask an org admin to build it.',
    )
  const repository = org.repositories.find((item) => item.id === repositoryId)
  if (!repository) {
    throw new RouteError(
      404,
      'repository_not_found',
      'The repository is not available.',
    )
  }
  // A draft can outlive its section. Its workspace then goes to General,
  // so that Try again does not fail on the same section again.
  const section =
    org.sections.find((item) => item.id === request.sectionId) ??
    defaultSection(org.sections)
  const fails = first.text.includes('fail')
  if (fails && !request.keepFailedStart) {
    throw new RouteError(
      502,
      'start_failed',
      'The cloud computer did not start. Try again.',
    )
  }
  const { user } = backend.state.account
  const owner: MessageSender = {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }
  const city = cityFor(org)
  const id = newWorkspaceId(org, city)
  const branch = `${user.githubLogin}/${id}`
  const at = backend.now()
  const workspace: Workspace = {
    id,
    number: ++org.workspaceNumberCount,
    link: new URL(routes.workspace(org.org.id, id), FAKE_ORIGIN).href,
    orgId: org.org.id,
    repositoryId,
    sectionId: section?.id ?? '',
    owner,
    name: null,
    branch,
    choice: first.choice,
    state: 'starting',
    github: null,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    restoreUntil: null,
  }
  org.workspaces = [workspace, ...org.workspaces]
  org.created.add(id)
  const plan = createPlan(org.org.name, repository, branch)
  const begun = fails
    ? failFirstStart(backend, org, id, plan)
    : { start: runStart(backend, org, id, 'create', plan), error: null }
  const sessionId = backend.newId()
  const attachments = first.attachmentIds.flatMap(
    (attachmentId) => backend.state.attachments.get(attachmentId) ?? [],
  )
  return {
    workspace: requireWorkspace(org, id),
    sessionId,
    firstMessage: {
      id: first.id,
      sessionId,
      sender: owner,
      text: first.text,
      attachments,
      choice: workspace.choice,
      createdAt: at,
      state: 'queued',
    },
    ...begun,
  }
}

/** Create workspace, from the first message of the user. */
function createWorkspace(
  backend: DevBackend,
  org: OrgState,
  body: unknown,
): Response {
  const fields = record(body)
  const created = startWorkspace(backend, org, {
    repositoryId: requiredText(fields, 'repositoryId'),
    sectionId: maybeText(fields, 'sectionId'),
    first: readFirstMessage(fields.firstMessage),
  })
  return json(created satisfies CreateWorkspaceResponse, 201)
}

export function createRoutes(backend: DevBackend): Route[] {
  return [
    {
      method: 'POST',
      path: workspacesPath(ID.org),
      answer: ({ params, body }) =>
        createWorkspace(backend, requireOrg(backend.state, params.org), body),
    },
  ]
}
