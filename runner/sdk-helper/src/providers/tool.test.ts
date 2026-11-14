import { expect, it } from 'vitest'

import { ClaudeEvents } from './claude-events'
import { codexNotification } from './codex-events'
import type { ProviderEvent } from '../generated/ProviderEvent'

const windowRead = { window_id: 7, query: 'menu' }

function claudeCall(): ProviderEvent[] {
  const events: ProviderEvent[] = []
  const mapper = new ClaudeEvents(
    new Map(),
    (event) => events.push(event),
    () => false,
  )
  mapper.accept({
    type: 'assistant',
    message: {
      id: 'message',
      content: [
        {
          type: 'tool_use',
          id: 'call',
          name: 'mcp__computer__get_window_state',
          input: windowRead,
        },
      ],
    },
  })
  return events
}

function codexCall(): ProviderEvent[] {
  const events: ProviderEvent[] = []
  codexNotification(
    'item/started',
    {
      item: {
        type: 'mcpToolCall',
        id: 'call',
        server: 'computer',
        tool: 'get_window_state',
        arguments: windowRead,
        status: 'inProgress',
      },
    },
    [],
    (event) => events.push(event),
  )
  return events
}

it.each([
  ['Claude', claudeCall],
  ['Codex', codexCall],
])(
  'shows a %s MCP tool by its name without the server, with its subject as the detail',
  (_, call) => {
    expect(call()).toEqual([
      {
        type: 'tool',
        tool: {
          id: 'call',
          kind: 'computer',
          target: 'get_window_state',
          detail: 'menu',
          omittedDetailBytes: 0,
          state: 'running',
        },
      },
    ])
  },
)
