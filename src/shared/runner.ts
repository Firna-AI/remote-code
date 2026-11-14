import type { RunnerProtocolVersion } from './generated/RunnerProtocolVersion'
import type { RunnerLoginKind } from './generated/RunnerLoginKind'
export const RUNNER_PROTOCOL_VERSION = 2 as const

export function isSupportedRunnerVersion(
  version: unknown,
): version is RunnerProtocolVersion {
  return version === RUNNER_PROTOCOL_VERSION
}

/**
 * Maximum UTF-8 bytes of JSON.stringify(the complete RunnerEventEnvelope).
 * Count its stream ID, number, timestamp, payload, escapes, and delimiters.
 * Add no spaces. Exclude WebSocket framing and the workspace storage wrapper.
 * One MiB leaves room below the storage value limit for that stored wrapper.
 */
export const RUNNER_EVENT_MAX_BYTES = 1_048_576

export const RUNNER_SUPPORTED_LOGIN_KINDS: readonly RunnerLoginKind[] = [
  { agent: 'claude', kind: 'token' },
  { agent: 'claude', kind: 'api-key' },
  { agent: 'codex', kind: 'token' },
  { agent: 'codex', kind: 'api-key' },
]

export function runnerSupportsLogin(
  login: RunnerLoginKind,
  advertised?: readonly RunnerLoginKind[],
): boolean {
  return advertised
    ? advertised.some(
        (kind) => kind.agent === login.agent && kind.kind === login.kind,
      )
    : login.agent !== 'codex' || login.kind !== 'token'
}
