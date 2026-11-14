import type { Agent } from '../../shared/generated/Agent'
import {
  agentLoginPath,
  refreshAgentLoginModelsPath,
  defaultAgentLoginNoReuse,
  type AgentLoginStatus,
  type SaveAgentLoginRequest,
  type SaveAgentLoginResponse,
  type UpdateAgentLoginResponse,
} from '../../shared/account'
import {
  ENDPOINT_ADDRESS_ERROR,
  readEndpointAddress,
} from '../../shared/endpoint-address'
import { choice, flag, record } from '../api/parse'
import { AGENTS } from '../api/read-core'
import type { DevBackend } from './backend'
import { json, noContent, requiredText, RouteError, type Route } from './router'
import { completeStep } from './state'

/** The saved status of one agent login of the account. */
export function savedLogin(
  backend: DevBackend,
  agent: Agent,
): AgentLoginStatus {
  return (
    backend.state.account.agentLogins.find((item) => item.agent === agent) ?? {
      agent,
      connected: false,
    }
  )
}

/** Puts the status of one agent login in the account, in the order of `AGENTS`. */
export function putLogin(backend: DevBackend, login: AgentLoginStatus): void {
  backend.state.account = {
    ...backend.state.account,
    agentLogins: AGENTS.map((agent): AgentLoginStatus =>
      agent === login.agent ? login : savedLogin(backend, agent),
    ),
  }
}

/**
 * Whether a saved login keeps other members out of the sessions of its
 * owner, as the Worker decides. A new secret of the same kind keeps the
 * choice. A new login, or one of another kind, takes the default of its
 * kind, from the shared account contract.
 */
export function noReuseOf(
  saved: AgentLoginStatus,
  kind: SaveAgentLoginRequest['kind'],
): boolean {
  return saved.connected && saved.kind === kind
    ? saved.noReuse
    : defaultAgentLoginNoReuse(saved.agent, kind)
}

/**
 * Save an agent login. The secret goes nowhere, and the answer holds only
 * the login metadata and its share choice. It completes the last step
 * of Get started.
 */
function saveLogin(backend: DevBackend, agent: Agent, body: unknown): Response {
  const fields = record(body)
  choice(fields, 'agent', [agent])
  requiredText(fields, 'secret')
  const updatedAt = backend.now()
  const saved = savedLogin(backend, agent)
  if (agent === 'codex' && fields.kind === 'token')
    throw new RouteError(
      400,
      'invalid_input',
      'Start the ChatGPT sign-in to connect Codex.',
    )
  let login: AgentLoginStatus
  if (fields.kind === 'endpoint') {
    const address = readEndpointAddress(fields.endpoint, agent)
    if (!address)
      throw new RouteError(
        400,
        ENDPOINT_ADDRESS_ERROR.code,
        ENDPOINT_ADDRESS_ERROR.message,
      )
    login = {
      agent,
      connected: true,
      kind: 'endpoint',
      host: address.host,
      noReuse: noReuseOf(saved, 'endpoint'),
      updatedAt,
    }
  } else if (agent === 'codex') {
    const kind = choice(fields, 'kind', ['api-key'])
    const noReuse = noReuseOf(saved, kind)
    login = { agent, connected: true, kind, noReuse, updatedAt }
  } else {
    const kind = choice(fields, 'kind', ['token', 'api-key'])
    const noReuse = noReuseOf(saved, kind)
    login = { agent, connected: true, kind, noReuse, updatedAt }
  }
  putLogin(
    backend,
    login.connected && login.kind === 'endpoint'
      ? {
          ...login,
          modelList: { missing: [], checkedAt: updatedAt },
        }
      : login,
  )
  completeStep(backend.state, 'agent-login')
  return json(login satisfies SaveAgentLoginResponse)
}

/**
 * Changes the share choice of a login, without its secret, and answers
 * with the saved status. A login that is gone answers as not connected.
 * With `shareSave=fail`, the change fails as a failed save of the Worker.
 */
function updateLogin(
  backend: DevBackend,
  agent: Agent,
  body: unknown,
): Response {
  const noReuse = flag(record(body), 'noReuse')
  if (backend.state.shareSaveFails) throw new Error('The save failed.')
  const saved = savedLogin(backend, agent)
  const login: UpdateAgentLoginResponse = saved.connected
    ? { ...saved, noReuse }
    : saved
  putLogin(backend, login)
  return json(login)
}

export function loginRoutes(backend: DevBackend, agent: Agent): Route[] {
  return [
    {
      method: 'POST',
      path: refreshAgentLoginModelsPath(agent),
      answer: () => {
        const login = savedLogin(backend, agent)
        if (login.connected && login.kind === 'endpoint')
          putLogin(backend, {
            ...login,
            modelList: { missing: [], checkedAt: backend.now() },
          })
        return noContent()
      },
    },
    {
      method: 'PUT',
      path: agentLoginPath(agent),
      answer: ({ body }) => saveLogin(backend, agent, body),
    },
    {
      method: 'PATCH',
      path: agentLoginPath(agent),
      answer: ({ body }) => updateLogin(backend, agent, body),
    },
    {
      method: 'DELETE',
      path: agentLoginPath(agent),
      answer: () => {
        putLogin(backend, { agent, connected: false })
        return noContent()
      },
    },
  ]
}
