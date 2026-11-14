import { expect, it } from 'vitest'
import type { RunnerEvent } from './generated/RunnerEvent'
import { boundChatEvent } from './event-limits'

it('retains earlier omission counts when bounding an older runner excerpt again', () => {
  const tool: RunnerEvent = {
    type: 'tool.updated',
    sessionId: 'session',
    turnId: 'turn',
    tool: {
      id: 'tool',
      kind: 'run',
      target: 'test',
      detail: 'kept',
      omittedDetailBytes: 7,
      state: 'done',
    },
  }
  const completed: RunnerEvent = {
    type: 'turn.completed',
    sessionId: 'session',
    turnId: 'turn',
    state: 'finished',
    durationMs: 0,
    files: [{ path: 'kept.ts', change: 'modified', added: 1, removed: 0 }],
    omittedFileCount: 9,
    userMessageIds: [],
  }
  expect(boundChatEvent(tool)).toEqual(tool)
  expect(boundChatEvent(completed)).toEqual(completed)
  expect(
    boundChatEvent({
      ...tool,
      tool: { ...tool.tool, detail: 'x'.repeat(65_535) },
    }),
  ).toEqual({
    ...tool,
    tool: { ...tool.tool, detail: 'x'.repeat(65_534), omittedDetailBytes: 8 },
  })
  const files = Array.from({ length: 201 }, (_, index) => ({
    path: `file-${index}`,
    change: 'modified' as const,
    added: 1,
    removed: 0,
  }))
  expect(boundChatEvent({ ...completed, files })).toEqual({
    ...completed,
    files: files.slice(0, 200),
    omittedFileCount: 10,
  })
})
