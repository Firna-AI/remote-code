import * as fs from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import type { Agent } from '../generated/Agent'
import { FakeAppServers } from '../../test-support/app-server'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import { turn } from '../../test-support/input'
import { fakeToolContext } from '../../test-support/input'
import { fakeClaudeProfile } from '../../test-support/profile'
import { createClaudeFactory } from './claude'
import { createCodexFactory } from './codex'
import * as environment from './environment'
import type { ProviderProcess } from './types'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(fs.readFile).mockReset()
})

function providerFixture(agent: Agent) {
  vi.spyOn(environment, 'prepareProviderHome').mockResolvedValue()
  const queries: FakeClaudeQuery[] = []
  const servers = new FakeAppServers()
  const factory =
    agent === 'claude'
      ? createClaudeFactory(
          (parameters) => {
            const query = new FakeClaudeQuery()
            queries.push(query)
            return query.open(parameters)
          },
          () => '/pinned/sdk/claude',
          fakeClaudeProfile,
        )
      : createCodexFactory(servers.start)
  const warnings: string[] = []
  const command = turn('computer', 'alice', agent)
  const options = {
    cwd: '/repo',
    home: '/private-agent-home',
    sessionId: command.sessionId,
    endpoint:
      fakeToolContext.machineOrigin +
      '/v1/model/' +
      command.message.choice.agent,
    credential: { type: 'gateway' as const, ...command.credential },
    commitAuthor: null,
    choice: command.message.choice,
    conversationId: null,
    instructions: '',
    tools: fakeToolContext,
    event: () => {},
    warn: (message: string) => warnings.push(message),
  }
  return {
    warnings,
    start: () => factory(options),
    computer: () =>
      agent === 'claude'
        ? queries.at(-1)?.parameters?.options?.mcpServers?.computer
        : servers.requests
            .at(-1)
            ?.args.filter((arg) => arg.startsWith('mcp_servers.computer.')),
    send: async (provider: ProviderProcess) => {
      await provider.send(command)
      return agent === 'claude'
        ? (await queries.at(-1)?.nextUser())?.message
        : servers.latest.writes.find((write) => write.method === 'turn/start')
            ?.params
    },
  }
}

it.each(['claude', 'codex'] as const)(
  'reads current sandbox computer stdio settings for each %s agent start',
  async (agent) => {
    const h = providerFixture(agent)
    const read = vi.mocked(fs.readFile)
    for (const version of ['first', 'second']) {
      const computer = {
        type: 'stdio',
        command: `/fake/${version}/computer-server`,
        args: ['--socket', `/run/test-${version}.sock`],
      }
      read.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: { computer, other: { command: 'do-not-copy' } },
          account: 'global-config-do-not-disclose',
        }),
      )
      const provider = await h.start()
      try {
        expect(h.computer()).toEqual(
          agent === 'claude'
            ? computer
            : [
                `mcp_servers.computer.command="/fake/${version}/computer-server"`,
                `mcp_servers.computer.args=["--socket","/run/test-${version}.sock"]`,
              ],
        )
      } finally {
        await provider.close()
      }
    }
    expect(read.mock.calls).toEqual([
      ['/home/user/.claude.json', 'utf8'],
      ['/home/user/.claude.json', 'utf8'],
    ])
    expect(h.warnings).toEqual([])
  },
)

it.each(['claude', 'codex'] as const)(
  'starts %s without computer tools and warns once when the sandbox entry is unavailable',
  async (agent) => {
    const h = providerFixture(agent)
    const read = vi.mocked(fs.readFile)
    const unavailable = [
      new Error('private-global-config-read-error'),
      JSON.stringify({ account: 'global-config-do-not-disclose' }),
      '{"account":"global-config-do-not-disclose",',
      JSON.stringify({
        mcpServers: { computer: { command: 'fake', args: [12] } },
      }),
    ]
    for (const [index, entry] of unavailable.entries()) {
      if (entry instanceof Error) read.mockRejectedValueOnce(entry)
      else read.mockResolvedValueOnce(entry)
      const provider = await h.start()
      try {
        expect(h.computer()).toEqual(agent === 'claude' ? undefined : [])
        expect(h.warnings).toHaveLength(index + 1)
        expect(await h.send(provider)).toMatchObject(
          agent === 'claude'
            ? {
                role: 'user',
                content:
                  'Sender: @alice [member ID: "alice"]\n\nChange the file.',
              }
            : { clientUserMessageId: 'message-computer' },
        )
      } finally {
        await provider.close()
      }
    }
    expect(read).toHaveBeenCalledTimes(4)
    expect(h.warnings).toEqual([
      'Computer tools are unavailable. The sandbox computer server settings could not be read.',
      'Computer tools are unavailable. The sandbox computer server settings could not be read.',
      'Computer tools are unavailable. The sandbox computer server settings could not be read.',
      'Computer tools are unavailable. The sandbox computer server settings could not be read.',
    ])
  },
)
