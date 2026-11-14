import type { DeviceCommandRecord } from '../../src/shared/generated/DeviceCommandRecord'
import type { DevicePairing } from '../../src/shared/generated/DevicePairing'

import type { AppEnv } from '../env'
import { HttpError } from '../http'
import type { Workspace } from '../workspace'

export type DeviceOperationValue =
  | {
      device: DevicePairing | null
      deviceName?: string | null
      sessionId?: string | null
    }
  | { cancelled: boolean }
  | { sent: boolean }
  | { accepted: boolean }
  | { live: boolean; known: boolean }
  | { valid: boolean; reason: string }
  | { claimed: boolean }
  | { request: DeviceCommandRecord }

export type DeviceOperationResult =
  | { ok: true; value: DeviceOperationValue }
  | { ok: false; status: number; code: string; message: string }

export function deviceStub(
  env: AppEnv,
  name: string,
): DurableObjectStub<Workspace> {
  if (!env.WORKSPACES)
    throw new HttpError(503, 'device_unavailable', 'The Mac is not available.')
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(name))
}
/** Fetched response headers are immutable. Preserve socket upgrades when copying. */
export function deviceResponse(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    ...(response.webSocket && { webSocket: response.webSocket }),
  })
}
export async function deviceCall(
  env: AppEnv,
  target: string,
  operation: Record<string, unknown>,
): Promise<unknown> {
  const result = await deviceStub(env, target).deviceOperation(
    target,
    operation,
  )
  if (!result.ok)
    throw new HttpError(result.status, result.code, result.message)
  return result.value
}
