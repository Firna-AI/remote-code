import { readFile } from 'node:fs/promises'

import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk'

import { object } from '../parse'

function isStdioServer(value: unknown): value is McpStdioServerConfig {
  const server = object(value)
  return (
    (server.type === undefined || server.type === 'stdio') &&
    typeof server.command === 'string' &&
    (server.args === undefined ||
      (Array.isArray(server.args) &&
        server.args.every((arg: unknown) => typeof arg === 'string'))) &&
    (server.env === undefined ||
      Object.values(object(server.env)).every(
        (item) => typeof item === 'string',
      )) &&
    (server.timeout === undefined ||
      (typeof server.timeout === 'number' &&
        Number.isFinite(server.timeout))) &&
    (server.alwaysLoad === undefined || typeof server.alwaysLoad === 'boolean')
  )
}

export async function readComputerServer(
  warn: (message: string) => void,
): Promise<McpStdioServerConfig | null> {
  try {
    const config: unknown = JSON.parse(
      await readFile('/home/user/.claude.json', 'utf8'),
    )
    const computer = object(object(config).mcpServers).computer
    if (isStdioServer(computer)) return computer
  } catch {
    // The platform config is optional for an agent start.
  }
  warn(
    'Computer tools are unavailable. The sandbox computer server settings could not be read.',
  )
  return null
}
