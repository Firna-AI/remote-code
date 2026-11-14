import { expect, it } from 'vitest'
import type { WorkspaceStart } from '../../src/shared/generated/WorkspaceStart'
import { FIRST_MESSAGE, lifecycleFixture } from './durable-test-support'

const ERROR = {
  code: 'workspace_start_failed',
  message: 'The cloud computer could not start. Try again.',
  log: null,
}
const RUNNING = {
  id: 'image',
  label: 'Starting from the newest image',
  state: 'running' as const,
  startedAt: 100,
  completedAt: null,
}
const COMPLETED = { ...RUNNING, state: 'completed' as const, completedAt: 120 }
const FAILED = { ...RUNNING, state: 'failed' as const, completedAt: 130 }
const FALLBACK: WorkspaceStart['steps'][number] = {
  id: 'start',
  label: 'Starting the cloud computer',
  state: 'failed',
  startedAt: 200,
  completedAt: 200,
}

it.each<{
  shape: string
  start: WorkspaceStart | null
  steps: WorkspaceStart['steps']
}>([
  { shape: 'missing start', start: null, steps: [FALLBACK] },
  {
    shape: 'empty create',
    start: { kind: 'create', startedAt: 90, steps: [] },
    steps: [FALLBACK],
  },
  {
    shape: 'running create',
    start: { kind: 'create', startedAt: 90, steps: [RUNNING] },
    steps: [{ ...RUNNING, state: 'failed', completedAt: 200 }],
  },
  {
    shape: 'failed create',
    start: { kind: 'create', startedAt: 90, steps: [FAILED] },
    steps: [FAILED],
  },
  {
    shape: 'completed create',
    start: { kind: 'create', startedAt: 90, steps: [COMPLETED] },
    steps: [COMPLETED, FALLBACK],
  },
])(
  'marks a failed create with $shape in one lifecycle write',
  async ({ start, steps }) => {
    const fixture = lifecycleFixture()
    await fixture.lifecycle.initialize({
      workspaceId: 'workspace-one',
      orgId: 'org-one',
      firstMessage: FIRST_MESSAGE,
    })
    if (start) await fixture.lifecycle.reportStart(start)
    fixture.hooks.changed.mockClear()
    fixture.setTime(200)
    await fixture.lifecycle.fail(ERROR, true)
    expect(await fixture.recreate().read()).toMatchObject({
      state: 'error',
      error: ERROR,
      start: { kind: 'create', startedAt: start?.startedAt ?? 200, steps },
    })
    expect(fixture.hooks.changed.mock.calls).toHaveLength(1)
    expect(fixture.hooks.changed.mock.calls[0]?.[0]).toMatchObject({
      state: 'error',
      error: ERROR,
      start: { kind: 'create', steps },
    })
    expect(fixture.alarmAt()).toBeNull()
  },
)

it.each<{
  shape: string
  start: WorkspaceStart | null
  steps: WorkspaceStart['steps'] | undefined
}>([
  { shape: 'missing start', start: null, steps: undefined },
  {
    shape: 'successful create',
    start: { kind: 'create', startedAt: 90, steps: [COMPLETED] },
    steps: [COMPLETED],
  },
  {
    shape: 'running resume',
    start: { kind: 'resume', startedAt: 90, steps: [RUNNING] },
    steps: [{ ...RUNNING, state: 'failed', completedAt: 200 }],
  },
])('keeps ordinary failure behavior for $shape', async ({ start, steps }) => {
  const fixture = lifecycleFixture()
  await fixture.lifecycle.initialize({
    workspaceId: 'workspace-one',
    orgId: 'org-one',
    firstMessage: FIRST_MESSAGE,
  })
  if (start) await fixture.lifecycle.reportStart(start)
  fixture.setTime(200)
  await fixture.lifecycle.fail(ERROR)
  const saved = await fixture.recreate().read()
  expect(saved?.state).toBe('error')
  expect(saved?.error).toEqual(ERROR)
  expect(saved?.start?.steps).toEqual(steps)
  expect(saved?.start?.kind).toBe(start?.kind)
})
