import type { ProviderEvent } from '../generated/ProviderEvent'

export function errorText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    return (
      value
        .flatMap((item: unknown) => (typeof item === 'string' ? [item] : []))
        .join('\n')
        .trim() || null
    )
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  )
    return value.message.trim() || null
  return null
}

export function authenticationFailure(): Extract<
  ProviderEvent,
  { type: 'failed' }
> {
  return {
    type: 'failed',
    code: 'agent_authentication_failed',
    message: 'The agent login failed. Reconnect your agent account.',
  }
}

/** Known causes get a short recovery action. Other causes keep their meaning. */
export function failureCause(
  value: unknown,
): Extract<ProviderEvent, { type: 'failed' }> {
  const message = errorText(value) ?? 'The agent request failed. Try again.'
  if (
    /401|unauth|authentication|invalid.?api.?key|expired.?token|invalid.?token|not logged in/i.test(
      message,
    )
  ) {
    return authenticationFailure()
  }
  if (
    /insufficient.quota|credit balance|quota exceeded|billing|usage limit/i.test(
      message,
    )
  ) {
    return {
      type: 'failed',
      code: 'agent_usage_limit',
      message:
        'The agent account reached its usage limit. Check your agent account.',
    }
  }
  if (/429|rate.?limit|overloaded|capacity/i.test(message)) {
    return {
      type: 'failed',
      code: 'agent_rate_limited',
      message: 'The agent reached its rate limit. Try again later.',
    }
  }
  if (
    /unknown model|invalid.{0,10}model|model.{0,80}(not found|does not exist|unsupported|not supported|access|unavailable)/i.test(
      message,
    )
  ) {
    return {
      type: 'failed',
      code: 'agent_model_unavailable',
      message: 'The selected model is unavailable. Choose another model.',
    }
  }
  return { type: 'failed', code: 'agent_failed', message }
}
