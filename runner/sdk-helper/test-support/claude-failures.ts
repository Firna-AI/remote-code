import { expect } from 'vitest'

import { createClaudeFactory } from '../src/providers/claude'
import type { ProviderEvent } from '../src/generated/ProviderEvent'
import type { ProviderOptions } from '../src/providers/types'
import { string } from '../src/parse'
import { FakeClaudeQuery } from './claude-query'
import { turn } from './input'

export async function checkClaudeFailures(
  options: ProviderOptions,
): Promise<void> {
  for (const scenario of [
    {
      error: 'authentication_failed',
      text: 'OAuth token revoked · Please run /login',
      code: 'agent_authentication_failed',
      message: 'The agent login failed. Reconnect your agent account.',
    },
    {
      error: 'max_output_tokens',
      text: 'Please switch to Sonnet for this request.',
      code: 'agent_failed',
      message: 'Please switch to Sonnet for this request.',
    },
    {
      error: null,
      text: 'The application can show an API error.',
      code: null,
      message: '',
    },
    {
      error: 'error_max_turns',
      text: 'The turn reached its configured turn count.',
      code: 'agent_failed',
      message: 'The turn reached its configured turn count.',
    },
  ]) {
    const sdk = new FakeClaudeQuery()
    const events: ProviderEvent[] = []
    const provider = await createClaudeFactory(
      sdk.open,
      () => '/pinned/claude',
    )({ ...options, event: (event) => events.push(event) })
    try {
      await provider.send(turn())
      const uuid = string((await sdk.nextUser()).uuid)
      await sdk.raw({
        type: 'assistant',
        error: scenario.error,
        user_message_uuids: [uuid],
        message: {
          id: 'answer',
          content: [{ type: 'text', text: scenario.text }],
        },
      })
      await sdk.raw({
        type: 'assistant',
        error: 'billing_error',
        parent_tool_use_id: 'child-tool',
        message: {
          id: 'child-error',
          content: [{ type: 'text', text: 'Child error' }],
        },
      })
      await sdk.raw({
        type: 'result',
        subtype:
          scenario.error === 'error_max_turns' ? 'error_max_turns' : 'success',
        is_error: scenario.code !== null,
        result: scenario.text,
        errors: [scenario.text],
        user_message_uuids: [uuid],
      })
      const expected: ProviderEvent[] =
        scenario.code === null
          ? [
              {
                type: 'answer',
                messageId: 'answer',
                text: scenario.text,
                userMessageIds: ['message-1'],
              },
            ]
          : [{ type: 'failed', code: scenario.code, message: scenario.message }]
      expect(
        events.filter(
          (event) => event.type === 'answer' || event.type === 'failed',
        ),
      ).toEqual(expected)
    } finally {
      await provider.close()
    }
  }
  const sdk = new FakeClaudeQuery()
  const events: ProviderEvent[] = []
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/pinned/claude',
  )({ ...options, event: (event) => events.push(event) })
  try {
    await provider.interrupt()
    await sdk.raw({
      type: 'assistant',
      error: 'authentication_failed',
      message: {
        id: 'stopped-error',
        content: [{ type: 'text', text: 'OAuth token revoked' }],
      },
    })
    await sdk.raw({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'OAuth token revoked',
    })
    expect(events).toEqual([
      { type: 'result', state: 'stopped', userMessageIds: [] },
    ])
  } finally {
    await provider.close()
  }
}
