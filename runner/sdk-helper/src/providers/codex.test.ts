import { beforeEach, expect, it, onTestFinished } from 'vitest'

import { FakeAppServers } from '../../test-support/app-server'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { providerFixture } from '../../test-support/fixture'
import { duringTurn, turn } from '../../test-support/input'
import { createCodexFactory } from './codex'

beforeEach(mockComputerServer)

it('streams App Server partial text and sends steer, model, and interrupt controls', async () => {
  const h = await providerFixture('codex')
  const servers = new FakeAppServers()
  const factory = createCodexFactory(servers.start)
  const provider = await factory(h.options)
  onTestFinished(() => provider.close())
  await provider.send(h.command)
  const server = servers.latest
  expect(servers.requests[0].env).not.toHaveProperty('OPENAI_API_KEY')
  expect(
    server.writes.find((write) => write.method === 'account/login/start'),
  ).toMatchObject({ params: { type: 'apiKey', apiKey: 'secret-alice' } })
  expect(servers.requests[0].args).toEqual(
    expect.arrayContaining([
      'model_providers.conductive.requires_openai_auth=true',
      'cli_auth_credentials_store="ephemeral"',
      'mcp_servers.computer.command="/fake/platform/computer-server"',
      'mcp_servers.computer.args=["--socket","/run/test-computer.sock"]',
    ]),
  )
  expect(JSON.stringify(servers.requests[0].args)).not.toContain('secret-alice')
  server.notify('item/agentMessage/delta', {
    itemId: 'codex-answer',
    delta: 'Hello ',
  })
  server.notify('item/agentMessage/delta', {
    itemId: 'codex-answer',
    delta: 'world',
  })
  expect(h.events).toContainEqual({
    type: 'delta',
    messageId: 'codex-answer',
    text: 'Hello ',
  })
  expect(h.events).toContainEqual({
    type: 'delta',
    messageId: 'codex-answer',
    text: 'world',
  })
  await provider.send({
    ...duringTurn(turn('2', 'alice', 'codex')),
    turnId: 'turn-1',
  })
  expect(
    server.writes.find((write) => write.method === 'turn/steer'),
  ).toMatchObject({
    params: {
      threadId: 'codex-conversation',
      expectedTurnId: 'codex-turn-1',
      clientUserMessageId: 'message-2',
    },
  })
  server.notify('item/started', {
    item: { id: 'command', type: 'commandExecution', command: 'npm test' },
  })
  server.notify('item/completed', {
    item: {
      id: 'command',
      type: 'commandExecution',
      command: 'npm test',
      status: 'completed',
    },
  })
  server.notify('item/completed', {
    item: { id: 'codex-answer', type: 'agentMessage', text: 'Hello world' },
  })
  server.notify('turn/completed', {
    turn: { id: 'codex-turn-1', status: 'completed' },
  })
  expect(h.events).toContainEqual({
    type: 'answer',
    messageId: 'codex-answer',
    text: 'Hello world',
    userMessageIds: ['message-1', 'message-2'],
  })
  expect(h.events).toContainEqual({
    type: 'result',
    state: 'finished',
    userMessageIds: ['message-1', 'message-2'],
  })
  const next = turn('3', 'alice', 'codex')
  const choice = {
    agent: 'codex' as const,
    model: 'next-model',
    effort: 'max' as const,
    fast: false,
  }
  expect(await provider.model(choice)).toBe('applied')
  await provider.send(next)
  expect(
    server.writes.findLast((write) => write.method === 'turn/start'),
  ).toMatchObject({
    params: {
      model: 'next-model',
      effort: 'max',
      serviceTierForTurn: 'default',
    },
  })
  expect(await provider.model({ ...choice, model: 'deferred-model' })).toBe(
    'deferred',
  )
  await provider.interrupt()
  expect(
    server.writes.findLast((write) => write.method === 'turn/interrupt'),
  ).toMatchObject({
    params: { threadId: 'codex-conversation', turnId: 'codex-turn-2' },
  })
  server.notify('turn/completed', {
    turn: { id: 'codex-turn-2', status: 'interrupted' },
  })
  expect(h.events).toContainEqual({
    type: 'result',
    state: 'stopped',
    userMessageIds: ['message-3'],
  })
  await provider.close()
  expect(server.closed).toBe(true)
  const resumed = await factory({
    ...h.options,
    conversationId: 'codex-conversation',
    credential: { type: 'gateway', ...turn('4', 'bob', 'codex').credential },
  })
  onTestFinished(() => resumed.close())
  expect(
    servers.latest.writes.find((write) => write.method === 'thread/resume'),
  ).toMatchObject({ params: { threadId: 'codex-conversation' } })
  expect(
    servers.latest.writes.find(
      (write) => write.method === 'account/login/start',
    ),
  ).toMatchObject({ params: { type: 'apiKey', apiKey: 'secret-bob' } })
  await resumed.send(turn('4', 'bob', 'codex'))
  servers.latest.notify('turn/completed', {
    turn: {
      id: 'codex-turn-1',
      status: 'failed',
      error: { message: 'Rate limit exceeded: secret-bob' },
    },
  })
  expect(h.events).toContainEqual({
    type: 'failed',
    code: 'agent_rate_limited',
    message: 'The agent reached its rate limit. Try again later.',
  })
  await resumed.send(turn('5', 'bob', 'codex'))
  servers.latest.notify('turn/completed', {
    turn: {
      id: 'codex-turn-2',
      status: 'failed',
      error: { message: 'The service is unavailable for secret-bob.' },
    },
  })
  expect(h.events).toContainEqual({
    type: 'failed',
    code: 'agent_failed',
    message: 'The service is unavailable for secret-bob.',
  })
})
