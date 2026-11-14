/** The runner supplies these values at runtime, separately for each turn. */
export const TOOL_ENV = {
  machineOrigin: 'CONDUCTIVE_MACHINE_ORIGIN',
  workspaceToken: 'CONDUCTIVE_WORKSPACE_TOKEN',
  turnId: 'CONDUCTIVE_TURN_ID',
} as const

/** Context is a turn identifier, not a credential or a sender identity. */
export const TOOL_TURN_HEADER = 'X-Conductive-Turn-Id'

/** Machine routes use workspace or turn tokens, or a GitHub webhook signature. */
export const MACHINE_PATHS = {
  runner: '/v1/runner',
  githubWebhook: '/v1/github/webhooks',
  gitCredential: '/v1/git/credential',
  workspaces: '/v1/tools/workspaces',
  claudeGateway: '/v1/model/claude',
  codexGateway: '/v1/model/codex',
  repositories: '/v1/tools/repositories',
  sections: '/v1/tools/sections',
  models: '/v1/tools/models',
} as const

/** @public The SDK helper registers this server with runtime turn and token context. */
export const WORKSPACE_TOOLS_MCP = {
  command: '/usr/local/bin/conductive',
  args: ['mcp'],
} as const
