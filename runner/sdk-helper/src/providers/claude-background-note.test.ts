import type { StopHookInput } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { backgroundFixture } from '../../test-support/background'

async function fixture() {
  const h = await backgroundFixture()
  const callback = h.sdk.parameters?.options?.hooks?.Stop?.[0]?.hooks[0]
  if (!callback) throw new Error('The adapter did not register its Stop hook.')
  const stop = (input: Partial<StopHookInput> = {}) =>
    callback(
      {
        hook_event_name: 'Stop',
        session_id: 'sdk-session',
        transcript_path: '/transcript',
        cwd: '/repo',
        stop_hook_active: false,
        ...input,
      },
      undefined,
      { signal: new AbortController().signal },
    )
  return { ...h, stop }
}

const guidance = [
  'This turn stays open while it runs, for up to 30 days from the first wait.',
  'A member message during a wait starts the count again.',
  'You get a notification when each task ends or each wake-up fires.',
  'Stop each task that you do not need, such as a dev server, with TaskStop.',
  'Delete each wake-up that you do not need with CronDelete.',
  'Then end your reply.',
]

it('gives non-error guidance once for each new live task or wake-up', async () => {
  const h = await fixture()
  const tasks = [
    {
      id: 'server',
      type: 'shell',
      status: 'running',
      description: 'Local\ndev   server',
    },
    {
      id: 'build',
      type: 'shell',
      status: 'pending',
      description: 'Build the image',
    },
  ]
  const crons = [
    {
      id: 'check',
      schedule: '0 23 * * *',
      recurring: false,
      prompt: 'Check\nprogress',
    },
  ]
  expect(
    await h.stop({ background_tasks: tasks, session_crons: crons }),
  ).toEqual({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: [
        'Background work still runs:',
        '- Task server: Local dev server',
        '- Task build: Build the image',
        '- Wake-up check (0 23 * * *): Check progress',
        ...guidance,
      ].join('\n'),
    },
  })
  expect(
    await h.stop({
      background_tasks: tasks,
      session_crons: crons,
      stop_hook_active: true,
    }),
  ).toEqual({})
  await h.state('running')
  expect(
    await h.stop({ background_tasks: tasks, session_crons: crons }),
  ).toEqual({})
  const next = {
    id: 'tests',
    type: 'shell',
    status: 'running',
    description: 'Run the tests',
  }
  expect(
    await h.stop({
      background_tasks: [...tasks, next],
      session_crons: crons,
      stop_hook_active: true,
    }),
  ).toEqual({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: [
        'Background work still runs:',
        '- Task tests: Run the tests',
        ...guidance,
      ].join('\n'),
    },
  })
  expect(await h.stop({ background_tasks: [next] })).toEqual({})
})

it('ignores absent, completed, and ambient work without marking it as already named', async () => {
  const h = await fixture()
  expect(await h.stop()).toEqual({})
  await h.tasks(true)
  const ambient = {
    id: 'watch',
    type: 'shell',
    status: 'running',
    description: 'Watch files',
  }
  const completed = {
    id: 'done',
    type: 'shell',
    status: 'completed',
    description: 'Finished check',
  }
  expect(
    await h.stop({ background_tasks: [ambient, completed], session_crons: [] }),
  ).toEqual({})
  await h.raw({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [],
  })
  expect(await h.stop({ background_tasks: [ambient] })).toEqual({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: [
        'Background work still runs:',
        '- Task watch: Watch files',
        ...guidance,
      ].join('\n'),
    },
  })
  const recurring = {
    id: 'loop',
    schedule: '*/5 * * * *',
    recurring: true,
    prompt: 'Check again',
  }
  expect(
    await h.stop({ session_crons: [recurring], background_tasks: [completed] }),
  ).toEqual({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: [
        'Background work still runs:',
        '- Wake-up loop (*/5 * * * *): Check again',
        ...guidance,
      ].join('\n'),
    },
  })
  expect(
    await h.stop({ session_crons: [recurring], stop_hook_active: true }),
  ).toEqual({})
})
