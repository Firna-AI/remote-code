import { beforeEach, expect, it, onTestFinished } from 'vitest'

import { FakeAppServers } from '../../test-support/app-server'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { providerFixture } from '../../test-support/fixture'
import { fakeToolContext } from '../../test-support/input'
import { fakeClaudeProfile } from '../../test-support/profile'
import { createClaudeFactory } from './claude'
import { createCodexFactory } from './codex'
import type { ProviderEvent } from '../generated/ProviderEvent'
import type { ProviderOptions } from './types'

beforeEach(mockComputerServer)

async function options(agent: 'claude' | 'codex') {
  const h = await providerFixture()
  const events: ProviderEvent[] = []
  const command = turn('1', 'alice', agent)
  const input: ProviderOptions = {
    cwd: h.root,
    home: h.home,
    sessionId: command.sessionId,
    endpoint: 'https://machines.conductive.test/v1/model/' + agent,
    credential: { type: 'gateway', ...command.credential },
    commitAuthor: null,
    choice: { ...command.message.choice, fast: true },
    conversationId: 'saved-conversation',
    instructions: '',
    tools: fakeToolContext,
    event: (event) => events.push(event),
    warn: h.options.warn,
  }
  return { input, command, events }
}

it('starts and changes Claude fast mode through flag settings without bypassing its account check', async () => {
  const { input } = await options('claude')
  const sdk = new FakeClaudeQuery()
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/pinned/claude',
    fakeClaudeProfile,
  )(input)
  onTestFinished(() => provider.close())
  expect(sdk.parameters?.options?.settings).toEqual({ fastMode: true })
  expect(sdk.parameters?.options?.env).not.toHaveProperty(
    'CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK',
  )
  await provider.model({ ...input.choice, fast: false })
  expect(sdk.efforts.at(-1)).toEqual({
    effortLevel: 'high',
    ultracode: false,
    fastMode: false,
  })
  await provider.model(input.choice)
  expect(sdk.efforts.at(-1)).toEqual({
    effortLevel: 'high',
    ultracode: false,
    fastMode: true,
  })
  await provider.close()
  const standard = new FakeClaudeQuery()
  const next = await createClaudeFactory(
    standard.open,
    () => '/pinned/claude',
    fakeClaudeProfile,
  )({ ...input, choice: { ...input.choice, fast: false } })
  onTestFinished(() => next.close())
  expect(standard.parameters?.options?.settings).toEqual({ fastMode: false })
})

it('sets the Codex tier per turn and defers only-fast changes until the next turn', async () => {
  const { input, command, events } = await options('codex')
  const servers = new FakeAppServers()
  const provider = await createCodexFactory(servers.start)(input)
  onTestFinished(() => provider.close())
  const server = servers.latest
  await provider.send(command)
  expect(
    server.writes.find((write) => write.method === 'turn/start'),
  ).toMatchObject({
    params: { serviceTierForTurn: 'priority' },
  })
  expect(await provider.model({ ...input.choice, fast: false })).toBe(
    'deferred',
  )
  server.notify('turn/completed', { turn: { status: 'completed' } })
  expect(events).toContainEqual({ type: 'speed', speed: { state: 'fast' } })
  await provider.send(command)
  expect(
    server.writes.findLast((write) => write.method === 'turn/start'),
  ).toMatchObject({
    params: { serviceTierForTurn: 'default' },
  })
  expect(
    server.writes
      .filter(
        (write) =>
          typeof write.method === 'string' &&
          write.method.startsWith('thread/'),
      )
      .map((write) => write.params),
  ).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ serviceTier: expect.anything() }),
    ]),
  )
})
