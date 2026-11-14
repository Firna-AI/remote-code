import type { Agent } from '../../shared/generated/Agent'
import type { AgentLoginStatus } from '../../shared/account'

/** The connected login kinds. Both agents support own endpoints. */
export type LoginKind = Extract<AgentLoginStatus, { connected: true }>['kind']

/** The kinds of each agent, in the order of its Connect form. */
export const agentLoginKinds: Readonly<
  Record<Agent, readonly [LoginKind, ...LoginKind[]]>
> = {
  claude: ['token', 'api-key', 'endpoint'],
  codex: ['api-key', 'token', 'endpoint'],
}

/** The names of the agents in the rows of the account and of Get started. */
export const agentNames: Readonly<Record<Agent, string>> = {
  claude: 'Claude',
  codex: 'Codex',
}

/**
 * The name of each kind of login, by agent, which is all that the app shows
 * of a login. The ChatGPT sign-in of Codex shows as the plan that Codex then
 * runs on, as `loginLabels` of the mockup fixtures names it.
 */
export const loginLabels: Readonly<
  Record<Agent, Readonly<Record<LoginKind, string>>>
> = {
  claude: {
    token: 'Subscription token',
    'api-key': 'API key',
    endpoint: 'Own endpoint',
  },
  codex: {
    token: 'ChatGPT plan',
    'api-key': 'API key',
    endpoint: 'Own endpoint',
  },
}

/** A number of repositories, such as "1 repository" or "6 repositories". */
export function repositoryCount(count: number): string {
  return count === 1 ? '1 repository' : `${count} repositories`
}
