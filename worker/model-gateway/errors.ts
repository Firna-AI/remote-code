import type { Agent } from '../../src/shared/generated/Agent'
import type { TurnTokenCheck } from './types'

type TurnRefusal = Extract<TurnTokenCheck, { ok: false }>['reason']
export type GatewayRefusal =
  | TurnRefusal
  | 'model_route_not_found'
  | 'model_client_not_allowed'
  | 'agent_mismatch'
  | 'model_gateway_unavailable'
  | 'model_upstream_unavailable'
  | 'model_request_refused'
  | 'model_endpoint_unreachable'

export class GatewayRequestError extends Error {
  readonly code: GatewayRefusal

  constructor(code: GatewayRefusal, message: string) {
    super(message)
    this.code = code
  }
}

export function refuseCodexBody(): never {
  throw new GatewayRequestError(
    'model_request_refused',
    refusals.model_request_refused[1],
  )
}

const refusals = {
  turn_token_invalid: [401, 'The turn token is not valid. Start a new turn.'],
  turn_not_active: [409, 'The turn has ended. Start a new turn.'],
  agent_login_changed: [403, 'The agent login changed. Start a new turn.'],
  agent_login_unavailable: [
    403,
    'The agent login is not available. Connect it again.',
  ],
  model_route_not_found: [404, 'The model route is not available.'],
  model_client_not_allowed: [
    403,
    'Use Claude for model requests on this route.',
  ],
  agent_mismatch: [403, 'Use the model route for this turn.'],
  model_gateway_unavailable: [
    503,
    'The model gateway is not available. Try again.',
  ],
  model_upstream_unavailable: [
    502,
    'The model service is not available. Try again.',
  ],
  model_endpoint_unreachable: [
    502,
    'The endpoint of this login is unreachable. Try again.',
  ],
  model_request_refused: [
    400,
    'Use one JSON object with background absent or false and no body encoding.',
  ],
} as const

export function gatewayError(
  agent: Agent,
  code: GatewayRefusal,
  cause?: string,
  chatgptRoute = false,
): Response {
  const [defaultStatus, defaultMessage] = refusals[code]
  const status =
    chatgptRoute && code === 'turn_token_invalid' ? 403 : defaultStatus
  const message = cause ?? defaultMessage
  const type =
    status >= 500
      ? 'api_error'
      : defaultStatus === 401
        ? 'authentication_error'
        : 'invalid_request_error'
  return Response.json(
    agent === 'claude'
      ? { type: 'error', error: { type, code, message } }
      : { error: { type, code, param: null, message } },
    { status },
  )
}
