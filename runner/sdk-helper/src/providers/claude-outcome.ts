import type {
  SDKAssistantMessageError,
  SDKResultError,
} from '@anthropic-ai/claude-agent-sdk'

import { authenticationFailure, errorText, failureCause } from './failure'
import type { ProviderEvent } from '../generated/ProviderEvent'

export type ClaudeOutcome =
  | { state: 'finished' | 'stopped' }
  | { state: 'failed'; failure: Extract<ProviderEvent, { type: 'failed' }> }

const errorResults: readonly SDKResultError['subtype'][] = [
  'error_during_execution',
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
]

export function assistantError(
  value: unknown,
): SDKAssistantMessageError | null {
  if (typeof value !== 'string') return null
  const kinds: readonly SDKAssistantMessageError[] = [
    'authentication_failed',
    'oauth_org_not_allowed',
    'account_on_hold',
    'verification_required',
    'billing_error',
    'rate_limit',
    'overloaded',
    'invalid_request',
    'model_not_found',
    'server_error',
    'unknown',
    'max_output_tokens',
    'cloud_credential_error',
  ]
  return kinds.find((kind) => kind === value) ?? 'unknown'
}

/** Both SDK result variants share one outcome, with interruption first. */
export function claudeOutcome(
  input: Record<string, unknown>,
  kind: SDKAssistantMessageError | null,
  stopped: boolean,
): ClaudeOutcome {
  if (stopped) return { state: 'stopped' }
  if (
    input.is_error !== true &&
    !errorResults.some((subtype) => subtype === input.subtype)
  )
    return { state: 'finished' }
  const cause = errorText(input.errors) ?? errorText(input.result)
  const login =
    kind === 'authentication_failed' ||
    kind === 'oauth_org_not_allowed' ||
    kind === 'cloud_credential_error'
  return {
    state: 'failed',
    failure: login ? authenticationFailure() : failureCause(cause),
  }
}
