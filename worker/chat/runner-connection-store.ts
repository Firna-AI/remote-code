import type { RunnerLoginKind } from '../../src/shared/generated/RunnerLoginKind'
import { RUNNER_SUPPORTED_LOGIN_KINDS } from '../../src/shared/runner'
import { isRecord } from '../http'
import type { ChatData, ChatStorage, RunnerWorkspaceRecord } from './types'

const KEY = 'native:runner:current'
const chunkKey = (part: number) => `native:runner:state:${part}`

export interface StoredRunnerConnection {
  id: string
  generation: number
  workspace: RunnerWorkspaceRecord
  streamId: string | null
  protocolVersion: number | null
  loginKinds?: readonly RunnerLoginKind[]
  ready: boolean
  checkAt: number
}

interface RunnerState {
  generation: number
  connection: StoredRunnerConnection | null
}

function readLoginKinds(value: unknown): readonly RunnerLoginKind[] {
  if (!Array.isArray(value))
    throw new Error('The saved runner connection is invalid.')
  return value.flatMap((item: unknown) => {
    if (!isRecord(item))
      throw new Error('The saved runner connection is invalid.')
    const kind = RUNNER_SUPPORTED_LOGIN_KINDS.find(
      (kind) => kind.agent === item.agent && kind.kind === item.kind,
    )
    return kind ? [kind] : []
  })
}

function readConnection(value: unknown): StoredRunnerConnection {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.generation !== 'number' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !isRecord(value.workspace) ||
    typeof value.workspace.id !== 'string' ||
    typeof value.workspace.orgId !== 'string' ||
    typeof value.workspace.tokenHash !== 'string' ||
    !(
      value.workspace.archivedAt === null ||
      typeof value.workspace.archivedAt === 'number'
    ) ||
    !(value.streamId === null || typeof value.streamId === 'string') ||
    !(
      value.protocolVersion === undefined ||
      value.protocolVersion === null ||
      (typeof value.protocolVersion === 'number' &&
        Number.isSafeInteger(value.protocolVersion) &&
        value.protocolVersion > 0)
    ) ||
    typeof value.ready !== 'boolean' ||
    typeof value.checkAt !== 'number' ||
    !Number.isFinite(value.checkAt)
  )
    throw new Error('The saved runner connection is invalid.')
  return {
    id: value.id,
    generation: value.generation,
    workspace: {
      id: value.workspace.id,
      orgId: value.workspace.orgId,
      tokenHash: value.workspace.tokenHash,
      archivedAt: value.workspace.archivedAt,
    },
    streamId: value.streamId,
    protocolVersion: value.protocolVersion ?? null,
    ...(value.loginKinds === undefined
      ? {}
      : { loginKinds: readLoginKinds(value.loginKinds) }),
    ready: value.ready,
    checkAt: value.checkAt,
  }
}

async function read(data: ChatData): Promise<RunnerState> {
  const stored: unknown = await data.get(KEY)
  if (stored === undefined) return { generation: 0, connection: null }
  if (!isRecord(stored) || typeof stored.parts !== 'number')
    throw new Error('The saved runner state is invalid.')
  const parts: string[] = []
  for (let part = 0; part < stored.parts; part++) {
    const text: unknown = await data.get(chunkKey(part))
    if (typeof text !== 'string')
      throw new Error('The saved runner state is incomplete.')
    parts.push(text)
  }
  const value: unknown = JSON.parse(parts.join(''))
  if (!isRecord(value) || typeof value.generation !== 'number')
    throw new Error('The saved runner state is invalid.')
  return {
    generation: value.generation,
    connection:
      value.connection === null ? null : readConnection(value.connection),
  }
}

async function write(data: ChatData, state: RunnerState): Promise<void> {
  const old = await data.get<{ parts: number }>(KEY)
  const text = JSON.stringify(state)
  const parts = Math.ceil(text.length / 16_000)
  for (let part = 0; part < parts; part++)
    await data.put(
      chunkKey(part),
      text.slice(part * 16_000, (part + 1) * 16_000),
    )
  for (let part = parts; part < (old?.parts ?? 0); part++)
    await data.delete(chunkKey(part))
  await data.put(KEY, { parts })
}

/** A durable tombstone prevents a closing socket from regaining authority. */
export class RunnerConnectionStore {
  private readonly storage: ChatStorage
  constructor(storage: ChatStorage) {
    this.storage = storage
  }

  async current(): Promise<StoredRunnerConnection | null> {
    return (await read(this.storage)).connection
  }

  replace(
    connection: Omit<StoredRunnerConnection, 'generation'>,
  ): Promise<StoredRunnerConnection> {
    return this.storage.transaction(async (data) => {
      const generation = (await read(data)).generation + 1
      const record = { ...connection, generation }
      await write(data, { generation, connection: record })
      return record
    })
  }

  save(
    connection: StoredRunnerConnection | null,
    generation: number,
  ): Promise<void> {
    return this.storage.transaction(async (data) => {
      const current = await read(data)
      if (
        current.generation !== generation ||
        (connection && !current.connection)
      )
        return
      await write(data, { generation, connection })
    })
  }
}
