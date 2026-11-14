import { describe, expect, test } from 'vitest'
import type { WorkspaceStart } from '../../shared/generated/WorkspaceStart'
import { FakeApiServer } from '../../test-support/fake-api'
import { FAKE_TIME } from '../../test-support/fixtures/core'
import { renderScreen, startedApp, textOf } from '../test-render'
import { StartingCard } from './StartingCard'

/** A create that began 6 seconds ago: one step done, and one that runs. */
const start: WorkspaceStart = {
  kind: 'create',
  startedAt: FAKE_TIME - 6_000,
  steps: [
    {
      id: 'image',
      label: 'Starting from the cloud computer of Acme',
      state: 'completed',
      startedAt: FAKE_TIME - 6_000,
      completedAt: FAKE_TIME - 2_000,
    },
    {
      id: 'branch',
      label: 'Creating branch calummoore/lisbon-7k2q',
      state: 'running',
      startedAt: FAKE_TIME - 2_000,
      completedAt: null,
    },
  ],
}

describe('StartingCard', () => {
  test('shows each finished step with its time, and the time since the start', async () => {
    const app = await startedApp(new FakeApiServer())
    const html = renderScreen(app, <StartingCard start={start} />)
    expect(textOf(html)).toContain(
      '› Starting from the cloud computer of Acme 4s › Creating branch calummoore/lisbon-7k2q Since the start: 6s',
    )
  })
})
