import type { AgentCreateWorkspaceRequest } from '../../src/shared/generated/AgentCreateWorkspaceRequest'

import { sessionTitleFrom } from '../../src/shared/session-title'
import { hash } from '../security/crypto'
import { HttpError } from '../http'
import { sessionLink } from '../../src/shared/session-link'
import { requireCallingToolTurn } from './calling-turn'
import { choice } from './input'
import { agentToolMessage } from './message-text'
import type { AgentToolServices } from './services'
import {
  type CallingWorkspace,
  creationSection,
  memberSender,
  ownerPreference,
  requireRepository,
} from './store'

export async function createFromTool(
  db: D1Database,
  caller: CallingWorkspace,
  turnId: string | null,
  input: AgentCreateWorkspaceRequest,
  services: AgentToolServices,
  origin: string,
) {
  const { turn, sender } = await requireCallingToolTurn(
    db,
    caller,
    turnId,
    services,
  )
  const firstMessageId = await hash(
    JSON.stringify([
      'create_workspace',
      caller.workspaceId,
      turn.sessionId,
      sender.id,
      input.requestId ?? crypto.randomUUID(),
    ]),
  )
  const previous = await services.replayWorkspaceCreation({
    orgId: caller.orgId,
    senderUserId: sender.id,
    firstMessageId,
    createdByWorkspaceId: caller.workspaceId,
  })
  if (previous) return previous
  const owner = await memberSender(db, caller.orgId, caller.ownerUserId)
  if (!sender || !owner) {
    throw new HttpError(
      403,
      'membership_required',
      'The workspace needs a current org member.',
    )
  }
  await requireRepository(db, caller.orgId, input.repositoryId)
  const sectionId = await creationSection(db, caller.orgId, input.sectionId)
  const defaults =
    input.model && input.effort !== undefined
      ? null
      : ((await ownerPreference(db, caller.ownerUserId)) ??
        (await services.ownerDefaultChoice?.(caller.ownerUserId)))
  const model = input.model ?? defaults
  const effort = input.effort ?? defaults?.effort
  if (!model || effort === undefined) {
    throw new HttpError(
      503,
      'owner_defaults_unavailable',
      'The default model is not available. Choose a model and effort.',
    )
  }
  const name = input.name === undefined ? null : sessionTitleFrom(input.name)
  return services.createWorkspace({
    orgId: caller.orgId,
    owner,
    repositoryId: input.repositoryId,
    sectionId,
    choice: choice({
      ...model,
      effort,
      fast:
        input.fast === true &&
        (await services.models()).some(
          (entry) =>
            entry.agent === model.agent &&
            entry.model === model.model &&
            entry.fast === true,
        ),
    }),
    firstMessageId,
    ...(input.firstSessionTitle !== undefined && {
      firstSessionTitle: input.firstSessionTitle,
    }),
    firstMessage: agentToolMessage(
      input.firstMessage,
      sessionLink(origin, caller.orgId, caller.workspaceId, turn.sessionId),
    ),
    ...(name !== null && { name }),
    sender,
    createdByWorkspaceId: caller.workspaceId,
  })
}
