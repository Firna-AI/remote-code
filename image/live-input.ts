import { resolve, sep } from 'node:path'
import type { AgentChoice } from '../src/shared/generated/AgentChoice'

export class CheckError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function object(value: unknown): Record<string, unknown> {
  if (!isObject(value))
    throw new CheckError('An external response has an invalid object.')
  return value
}

export function text(value: unknown): string {
  if (typeof value !== 'string' || !value)
    throw new CheckError('An external response has an invalid string.')
  return value
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new CheckError('An external response has an invalid counter.')
  return value
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (!value) throw new CheckError(`Set ${key}.`)
  return value
}

function origin(value: string): string {
  const url = new URL(value)
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new CheckError('Use HTTPS origins, or HTTP origins on localhost.')
  return url.origin
}

export const requiredInputs = [
  'LIVE_APP_ORIGIN',
  'LIVE_MACHINE_ORIGIN',
  'LIVE_COOKIE',
  'LIVE_ORG_ID',
  'LIVE_REPOSITORY_ID',
  'LIVE_BOAT_KEY',
  'LIVE_BOAT_ORG',
  'LIVE_AGENT',
  'LIVE_MODEL',
  'LIVE_AGENT_LOGIN',
] as const

export function liveConfiguration(env: NodeJS.ProcessEnv, root: string) {
  const appOrigin = origin(required(env, 'LIVE_APP_ORIGIN'))
  const machineOrigin = origin(required(env, 'LIVE_MACHINE_ORIGIN'))
  const agent = required(env, 'LIVE_AGENT')
  if (agent !== 'claude' && agent !== 'codex')
    throw new CheckError('LIVE_AGENT must be claude or codex.')
  const loginKind = env.LIVE_AGENT_LOGIN_KIND ?? 'api-key'
  if (loginKind !== 'api-key' && !(agent === 'claude' && loginKind === 'token'))
    throw new CheckError(
      'Use api-key, or token for Claude, as LIVE_AGENT_LOGIN_KIND.',
    )
  const runs = Number(env.LIVE_RUNS ?? '3')
  if (!Number.isSafeInteger(runs) || runs < 3)
    throw new CheckError('LIVE_RUNS must be at least 3.')
  const output = resolve(
    root,
    env.LIVE_OUTPUT ?? `.context/chat-live-check/run-${Date.now()}`,
  )
  if (!output.startsWith(`${resolve(root, '.context')}${sep}`))
    throw new CheckError('Save live-check output under .context/.')
  const boatApi = new URL(env.LIVE_BOAT_API ?? 'https://boat.dev/api/v1')
  if (
    boatApi.href !== 'https://boat.dev/api/v1' &&
    !(
      boatApi.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(boatApi.hostname)
    )
  )
    throw new CheckError(
      'LIVE_BOAT_API can override Boat only with a local fake endpoint.',
    )
  if (boatApi.username || boatApi.password || boatApi.search || boatApi.hash)
    throw new CheckError(
      'LIVE_BOAT_API cannot contain credentials, a query, or a fragment.',
    )
  const choice: AgentChoice = {
    agent,
    model: required(env, 'LIVE_MODEL'),
    effort: 'low',
    fast: false,
  }
  return {
    appOrigin,
    machineOrigin,
    choice,
    loginKind,
    runs,
    output,
    orgId: required(env, 'LIVE_ORG_ID'),
    repositoryId: required(env, 'LIVE_REPOSITORY_ID'),
    cookie: required(env, 'LIVE_COOKIE'),
    boatKey: required(env, 'LIVE_BOAT_KEY'),
    boatOrg: required(env, 'LIVE_BOAT_ORG'),
    boatApi: boatApi.href,
    login: required(env, 'LIVE_AGENT_LOGIN'),
    software: env.LIVE_SOFTWARE_DIR ?? '/opt/conductive/current',
  }
}

export type LiveConfiguration = ReturnType<typeof liveConfiguration>

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export async function until<T>(
  read: () => Promise<T | null>,
  description: string,
): Promise<T> {
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new CheckError(`Timed out while waiting for ${description}.`)
}
