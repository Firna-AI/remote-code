import type { Agent } from '../../src/shared/generated/Agent'
import { decryptAgentLogin } from '../chat/queries'
import type { AppDependencies, AppEnv } from '../env'
import {
  claimEndpointModelRead,
  saveEndpointModels,
} from './endpoint-model-data'
import { readEndpointModels } from './endpoint-models'

/** Save, Refresh, and dispatch share the same private, best-effort read. */
export async function refreshEndpointModels(
  env: AppEnv,
  userId: string,
  agent: Agent,
  dependencies: Pick<AppDependencies, 'fetch' | 'now'>,
  {
    background = false,
    ciphertext,
  }: { background?: boolean; ciphertext?: string } = {},
): Promise<void> {
  try {
    const read = await claimEndpointModelRead(
      env.DB,
      userId,
      agent,
      dependencies.now(),
      background,
      ciphertext,
    )
    if (!read) return
    const login = await decryptAgentLogin(
      env,
      userId,
      { agent, kind: 'endpoint' },
      read.ciphertext,
    )
    if (login?.kind !== 'endpoint') return
    const ids = await readEndpointModels(
      login,
      dependencies.fetch,
      env.PREVIEW_DOMAIN ? [env.PREVIEW_DOMAIN] : [],
    )
    if (ids !== null)
      await saveEndpointModels(env.DB, read, ids, dependencies.now())
  } catch {
    // A discovery failure never fails a login save or a turn.
  }
}
