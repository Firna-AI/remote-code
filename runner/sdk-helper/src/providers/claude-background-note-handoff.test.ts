import { beforeEach, expect, it, onTestFinished } from 'vitest'
import { FakeClaudeQuery } from '../../test-support/claude-query'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { providerFixture } from '../../test-support/fixture'
import { fakeClaudeProfile } from '../../test-support/profile'
import { createClaudeFactory } from './claude'

beforeEach(mockComputerServer)
async function stop(sdk: FakeClaudeQuery, id = 'same-job') {
  const callback = sdk.parameters?.options?.hooks?.Stop?.[0]?.hooks[0]
  if (!callback) throw new Error('The adapter did not register its Stop hook.')
  return callback(
    {
      hook_event_name: 'Stop',
      session_id: 'sdk-session',
      transcript_path: '/transcript',
      cwd: '/repo',
      stop_hook_active: false,
      session_crons: [
        {
          id,
          schedule: '0 23 * * *',
          recurring: true,
          prompt: 'Check progress',
        },
      ],
    },
    undefined,
    { signal: new AbortController().signal },
  )
}

it('keeps named work IDs across provider handoffs and ignores closed hooks', async () => {
  const h = await providerFixture()
  const first = new FakeClaudeQuery()
  const ids = new Set<string>()
  const initial = await createClaudeFactory(
    first.open,
    () => '/pinned/claude',
    fakeClaudeProfile,
  )({ ...h.options, backgroundNoteIds: ids })
  onTestFinished(() => initial.close())
  expect(await stop(first)).toMatchObject({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: expect.stringContaining('Wake-up same-job'),
    },
  })
  expect([...ids]).toEqual(['cron:same-job'])
  await initial.close()
  const second = new FakeClaudeQuery()
  const next = await createClaudeFactory(
    second.open,
    () => '/pinned/claude',
    fakeClaudeProfile,
  )({ ...h.options, backgroundNoteIds: new Set(ids) })
  onTestFinished(() => next.close())
  expect(await stop(second)).toEqual({})
  expect(await stop(first, 'new-job')).toEqual({})
  expect(await stop(second, 'new-job')).toMatchObject({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: expect.stringContaining('Wake-up new-job'),
    },
  })
})
