import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { FakeClaudeQuery } from '../../test-support/claude-query'
import { checkClaudeFailures } from '../../test-support/claude-failures'
import {
  fakeComputerServer,
  mockComputerServer,
} from '../../test-support/computer-mcp'
import { providerFixture } from '../../test-support/fixture'
import { duringTurn, turn } from '../../test-support/input'
import { string } from '../parse'
import { createClaudeFactory } from './claude'

beforeEach(mockComputerServer)

it('maps SDK partial text, thinking, tools, message UUIDs, and stopped output', async () => {
  const h = await providerFixture()
  vi.stubEnv('ANTHROPIC_API_KEY', 'another-account')
  onTestFinished(() => {
    vi.unstubAllEnvs()
  })
  const sdk = new FakeClaudeQuery()
  const factory = createClaudeFactory(sdk.open, () => '/pinned/sdk/claude')
  const provider = await factory(h.options)
  onTestFinished(() => provider.close())
  await provider.send(turn())
  const first = await sdk.nextUser()
  const uuid1 = string(first.uuid)
  await provider.send({ ...duringTurn(turn('2')), turnId: 'turn-1' })
  const second = await sdk.nextUser()
  const uuid2 = string(second.uuid)
  expect(first.priority).toBe('next')
  const sdkOptions = sdk.parameters?.options
  const env = sdkOptions?.env ?? {}
  expect(sdkOptions).toMatchObject({
    pathToClaudeCodeExecutable: '/pinned/sdk/claude',
    includePartialMessages: true,
    persistSession: true,
    mcpServers: { computer: fakeComputerServer },
  })
  expect(env.CLAUDE_CONFIG_DIR).toBe(`${h.home}/.conductive/claude`)
  expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
  expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN')
  await sdk.raw({ type: 'system', subtype: 'init', session_id: 'sdk-session' })
  await sdk.raw({
    type: 'system',
    subtype: 'thinking_tokens',
    thinking_tokens: 32,
  })
  await sdk.raw({
    type: 'stream_event',
    user_message_uuids: [uuid1, uuid2],
    event: { type: 'message_start', message: { id: 'sdk-answer' } },
  })
  await sdk.raw({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Part ' },
    },
  })
  await sdk.raw({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'two' },
    },
  })
  expect(h.events).toContainEqual({
    type: 'delta',
    messageId: 'sdk-answer',
    text: 'Part ',
  })
  await sdk.raw({
    type: 'assistant',
    message: {
      id: 'tool-answer',
      content: [
        {
          type: 'tool_use',
          id: 'sdk-tool',
          name: 'Read',
          input: { file_path: 'README.md' },
        },
      ],
    },
  })
  await sdk.raw({
    type: 'assistant',
    message: {
      id: 'synthetic',
      content: [{ type: 'text', text: '[Request interrupted by user]' }],
    },
  })
  await sdk.raw({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'sdk-tool' }] },
  })
  await sdk.raw({
    type: 'assistant',
    user_message_uuids: [uuid1, uuid2],
    message: {
      id: 'sdk-answer',
      content: [
        { type: 'text', text: 'Part ' },
        { type: 'text', text: 'two' },
      ],
    },
  })
  await provider.model({
    agent: 'claude',
    model: 'new-model',
    effort: 'max',
    fast: false,
  })
  expect(sdk.models.at(-1)).toBe('new-model')
  expect(sdk.efforts.at(-1)).toEqual({
    effortLevel: 'max',
    ultracode: false,
    fastMode: false,
  })
  await provider.interrupt()
  await sdk.raw({
    type: 'result',
    is_error: false,
    user_message_uuids: [uuid1, uuid2],
  })
  expect(sdk.interrupts).toBe(1)
  expect(h.events).toContainEqual({ type: 'thinking' })
  expect(h.events).toContainEqual({ type: 'conversation', id: 'sdk-session' })
  expect(h.events).toContainEqual({
    type: 'answer',
    messageId: 'sdk-answer',
    text: 'Part two',
    userMessageIds: ['message-1', 'message-2'],
  })
  expect(
    h.events.flatMap((event) =>
      event.type === 'delta' && event.messageId === 'sdk-answer'
        ? [event.text]
        : [],
    ),
  ).toEqual(['Part ', 'two'])
  expect(h.events).toContainEqual({
    type: 'tool',
    tool: {
      id: 'sdk-tool',
      kind: 'read',
      target: 'README.md',
      detail: null,
      omittedDetailBytes: 0,
      state: 'done',
    },
  })
  expect(JSON.stringify(h.events)).not.toContain('Request interrupted')
  expect(h.events).toContainEqual({
    type: 'result',
    state: 'stopped',
    userMessageIds: ['message-1', 'message-2'],
  })
  await provider.close()
  expect(sdk.closed).toBe(true)
  await checkClaudeFailures(h.options)
})
