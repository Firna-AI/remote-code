import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord'
import type { Workspace } from '../../src/shared/generated/Workspace'
import type { WorkspaceState } from '../../src/shared/generated/WorkspaceState'

import { workspaceRestoreUntil } from '../../src/shared/workspaces'
import type { WorkspaceChat } from '../chat/backend'
import type { ChatStorage, ChatCallbackPublisher } from '../chat/types'
import type { AppEnv } from '../env'
import {
  readDeviceWorkspace,
  enterDeviceInput,
  restoreDeviceInput,
} from './data'

const INPUT_KEY = 'devices:v1:input-state'
interface InputState {
  previous: WorkspaceState
}
export type DeviceStateProjection = (
  request: DeviceCommandRecord,
  now: number,
  publish: ChatCallbackPublisher,
) => Promise<boolean>

/** Device changes join the same state-write owner as lifecycle changes. */
export async function publishDeviceState(
  storage: ChatStorage,
  chat: WorkspaceChat,
  env: AppEnv,
  request: DeviceCommandRecord,
  readWaiting: () => Promise<boolean>,
  now = Date.now(),
  projection?: DeviceStateProjection,
): Promise<void> {
  return chat.authorizedWorkspaceOperation(
    request.workspaceId,
    async () => undefined,
    async (operation) => {
      const publish: ChatCallbackPublisher = async (event, occurredAt) => {
        await operation.change((transaction) =>
          transaction.emit(event, occurredAt),
        )
      }
      if (projection && (await projection(request, now, publish))) {
        await storage.delete(INPUT_KEY)
        return
      }
      await publishFallback(
        storage,
        chat,
        env,
        request,
        await readWaiting(),
        now,
        publish,
      )
    },
  )
}

async function publishFallback(
  storage: ChatStorage,
  chat: WorkspaceChat,
  env: AppEnv,
  request: DeviceCommandRecord,
  waiting: boolean,
  now: number,
  publish: ChatCallbackPublisher,
): Promise<void> {
  let row = await readDeviceWorkspace(env.DB, request.workspaceId)
  if (!row) return
  const baseline = await storage.get<InputState>(INPUT_KEY)
  if (
    waiting &&
    ['working', 'ready', 'unread', 'starting'].includes(row.state)
  ) {
    const updatedAt = Math.max(now, row.updatedAt + 1)
    // This marker also repairs a restart between the KV write and D1 update.
    await storage.put(INPUT_KEY, { previous: row.state })
    await enterDeviceInput(env.DB, row.id, row.state, updatedAt)
  } else if (!waiting && baseline) {
    await restoreDeviceInput(env.DB, row.id, baseline.previous, now)
    await storage.delete(INPUT_KEY)
  }
  row = await readDeviceWorkspace(env.DB, request.workspaceId)
  const session = await chat.store.read(request.workspaceId, (view) =>
    view.session(request.sessionId),
  )
  if (!row || !session) return
  const workspace: Omit<Workspace, 'link'> = {
    id: row.id,
    number: row.number,
    orgId: row.orgId,
    repositoryId: row.repositoryId,
    sectionId: row.sectionId,
    owner: {
      id: row.ownerId,
      githubLogin: row.githubLogin,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
    },
    name: row.name,
    branch: row.branch,
    choice: session.choice,
    state: row.state,
    github: row.github,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    restoreUntil: workspaceRestoreUntil(row.archivedAt, row.sandboxId),
  }
  await publish(
    {
      type: 'workspace.updated',
      workspace,
    },
    now,
  )
}
