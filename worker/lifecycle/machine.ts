import { MACHINE_PATHS, TOOL_TURN_HEADER } from '../../src/shared/agent-tools'

import { suspendedUserError } from '../data/user-access'
import { HttpError, privateResponse } from '../http'
import { hash } from '../security/crypto'
import { freshGitHubUserToken } from '../security/github-tokens'
import { errorSummary, WarningId } from '../warning-values'
import { warnWorker } from '../warnings'
import { readMachineCredentialAccess } from './machine-credential-data'
import {
  authenticateWorkspaceToken,
  workspaceTokenRefusedError,
} from './tokens'
import type {
  WorkspaceRuntime,
  WorkspaceLifecycleEndpoint,
} from './workspace-runtime'

type CredentialRuntime = Omit<WorkspaceRuntime, 'workspace'> & {
  workspace(id: string): Pick<WorkspaceLifecycleEndpoint, 'credentialSender'>
}

/** The machine-host dispatcher calls this handler before browser routing. */
export async function handleGitCredential(
  request: Request,
  runtime: CredentialRuntime,
): Promise<Response> {
  if (
    !runtime.env.MACHINE_ORIGIN ||
    new URL(request.url).origin !== runtime.env.MACHINE_ORIGIN
  )
    throw new HttpError(
      403,
      'machine_origin_required',
      'The machine endpoint is not available.',
    )
  if (
    new URL(request.url).pathname !== MACHINE_PATHS.gitCredential ||
    request.method !== 'POST'
  )
    throw new HttpError(404, 'not_found', 'The page is not available.')
  return credentialResponse(
    runtime,
    request.headers.get('Authorization'),
    request.headers.get(TOOL_TURN_HEADER),
  )
}

/** Each failure logs its code, because the helper in the sandbox keeps no record. */
async function credentialResponse(
  runtime: CredentialRuntime,
  authorization: string | null,
  turnId: string | null,
): Promise<Response> {
  let workspaceId: string | null = null
  try {
    if (!authorization?.startsWith('Bearer '))
      throw workspaceTokenRefusedError()
    const bearer = authorization.slice(7)
    const tokenHash = await hash(bearer)
    const identity = await authenticateWorkspaceToken(runtime.env, bearer)
    workspaceId = identity.workspaceId
    const senderId = await authorizeCredential(
      runtime,
      identity,
      tokenHash,
      turnId,
    )
    const token = await freshGitHubUserToken(
      runtime.env,
      senderId,
      runtime.dependencies,
    )
    const currentSenderId = await authorizeCredential(
      runtime,
      await authenticateWorkspaceToken(runtime.env, bearer),
      tokenHash,
      turnId,
    )
    if (currentSenderId !== senderId) throw workspaceTokenRefusedError()
    return privateResponse(Response.json({ token }))
  } catch (error) {
    warnWorker({
      kind: 'git_credential_failed',
      workspaceId: workspaceId === null ? null : WarningId.checked(workspaceId),
      turn: turnId !== null,
      error: errorSummary(error),
    })
    throw error
  }
}

async function authorizeCredential(
  runtime: CredentialRuntime,
  identity: { workspaceId: string; orgId: string },
  tokenHash: string,
  turnId: string | null,
): Promise<string> {
  const senderId =
    turnId === null
      ? null
      : await runtime.workspace(identity.workspaceId).credentialSender(turnId)
  if (turnId !== null && !senderId) throw currentTurnRequired()
  const access = await readMachineCredentialAccess(runtime.env.DB, {
    ...identity,
    tokenHash,
    senderId,
  })
  if (!access) throw workspaceTokenRefusedError()
  if (access.senderSuspendedAt !== null) throw suspendedUserError()
  if (access.memberUserId === null)
    throw new HttpError(404, 'org_not_found', 'The org is not available.')
  return access.senderId
}

function currentTurnRequired(): HttpError {
  return new HttpError(
    409,
    'current_turn_required',
    'Start an agent turn to use GitHub access.',
  )
}
