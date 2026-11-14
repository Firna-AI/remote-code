import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { FakeAppServers } from '../../test-support/app-server'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import {
  fakeComputerServer,
  mockComputerServer,
} from '../../test-support/computer-mcp'
import { providerFixture } from '../../test-support/fixture'
import { duringTurn, turn } from '../../test-support/input'
import { createClaudeFactory } from './claude'
import { createCodexFactory } from './codex'

beforeEach(mockComputerServer)

it.each(['claude', 'codex'] as const)(
  'registers workspace tools for %s with fresh active turn context and no login in its environment',
  async (agent) => {
    const h = await providerFixture(agent)
    for (const name of [
      'CONDUCTIVE_MACHINE_ORIGIN',
      'CONDUCTIVE_WORKSPACE_TOKEN',
      'CONDUCTIVE_TURN_ID',
    ])
      vi.stubEnv(name, 'stale-inherited-context')
    vi.stubEnv('GIT_AUTHOR_NAME', 'Inherited Author')
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'inherited-author@example.test')
    vi.stubEnv('GIT_COMMITTER_NAME', 'Inherited Committer')
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'inherited-committer@example.test')
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    const queries: FakeClaudeQuery[] = []
    const servers = new FakeAppServers()
    const factory =
      agent === 'claude'
        ? createClaudeFactory(
            (parameters) => {
              const sdk = new FakeClaudeQuery()
              queries.push(sdk)
              return sdk.open(parameters)
            },
            () => '/pinned/claude',
          )
        : createCodexFactory(servers.start)
    const environment = () =>
      agent === 'claude'
        ? queries.at(-1)?.parameters?.options?.env
        : servers.requests.at(-1)?.env
    const registration = () =>
      agent === 'claude'
        ? queries.at(-1)?.parameters?.options?.mcpServers
        : servers.requests
            .at(-1)
            ?.args.filter((value) => value.startsWith('mcp_servers.'))
    const first = turn('first', 'alice', agent)
    const author = {
      name: 'Alice Example',
      email: '1+alice@users.noreply.github.com',
    }
    const provider = await factory({
      ...h.options,
      tools: { ...h.options.tools, turnId: first.turnId },
      commitAuthor: author,
    })
    onTestFinished(() => provider.close())
    await provider.send(first)
    const check = (turnId: string) => {
      expect(environment()).toMatchObject({
        CONDUCTIVE_MACHINE_ORIGIN: 'https://machines.conductive.test',
        CONDUCTIVE_WORKSPACE_TOKEN: 'workspace-secret',
        CONDUCTIVE_TURN_ID: turnId,
      })
      for (const name of [
        'CLAUDE_CODE_OAUTH_TOKEN',
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
      ])
        expect(environment()).not.toHaveProperty(name)
      expect(registration()).toEqual(
        agent === 'claude'
          ? {
              computer: fakeComputerServer,
              conductive: {
                command: '/usr/local/bin/conductive',
                args: ['mcp'],
              },
            }
          : [
              'mcp_servers.conductive.command="/usr/local/bin/conductive"',
              'mcp_servers.conductive.args=["mcp"]',
              'mcp_servers.conductive.env_vars=["CONDUCTIVE_MACHINE_ORIGIN","CONDUCTIVE_WORKSPACE_TOKEN","CONDUCTIVE_TURN_ID"]',
              'mcp_servers.computer.command="/fake/platform/computer-server"',
              'mcp_servers.computer.args=["--socket","/run/test-computer.sock"]',
            ],
      )
      expect(JSON.stringify(registration())).not.toContain('workspace-secret')
      expect(JSON.stringify(registration())).not.toContain(
        'https://machines.conductive.test',
      )
      expect(JSON.stringify(registration())).not.toContain(turnId)
    }
    check('turn-first')
    expect(environment()).toMatchObject({
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    })
    await provider.send({
      ...duringTurn(turn('during', 'bob', agent)),
      turnId: first.turnId,
    })
    check('turn-first')
    expect(environment()).toMatchObject({
      GIT_AUTHOR_NAME: author.name,
      GIT_COMMITTER_NAME: author.name,
    })
    await provider.stop()
    const next = await factory({
      ...h.options,
      tools: { ...h.options.tools, turnId: 'turn-second' },
      commitAuthor: {
        name: 'Bob Example',
        email: '2+bob@users.noreply.github.com',
      },
    })
    onTestFinished(() => next.close())
    check('turn-second')
    expect(environment()).toMatchObject({
      GIT_AUTHOR_NAME: 'Bob Example',
      GIT_COMMITTER_NAME: 'Bob Example',
    })
    const concurrent = await factory({
      ...h.options,
      sessionId: 'parallel-session',
      tools: { ...h.options.tools, turnId: 'turn-parallel' },
    })
    onTestFinished(() => concurrent.close())
    check('turn-parallel')
    expect(environment()).toMatchObject({
      GIT_AUTHOR_NAME: 'Inherited Author',
      GIT_AUTHOR_EMAIL: 'inherited-author@example.test',
      GIT_COMMITTER_NAME: 'Inherited Committer',
      GIT_COMMITTER_EMAIL: 'inherited-committer@example.test',
    })
    expect(
      agent === 'claude'
        ? queries[1].parameters?.options?.env?.CONDUCTIVE_TURN_ID
        : servers.requests[1].env.CONDUCTIVE_TURN_ID,
    ).toBe('turn-second')
    await Promise.all([next.close(), concurrent.close()])
    expect(
      agent === 'claude'
        ? queries.map(({ closed }) => closed)
        : servers.processes.map(({ closed }) => closed),
    ).toEqual([true, true, true])
    expect(h.warnings).toEqual([])
  },
)
