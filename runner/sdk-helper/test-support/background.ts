import { beforeEach, onTestFinished } from 'vitest'
import { createClaudeFactory } from '../src/providers/claude'
import { FakeClaudeQuery } from './claude-query'
import { mockComputerServer } from './computer-mcp'
import { providerFixture } from './fixture'
import { fakeClaudeProfile } from './profile'

beforeEach(mockComputerServer)
export async function backgroundFixture() {
  const h = await providerFixture()
  const sdk = new FakeClaudeQuery()
  const provider = await createClaudeFactory(
    sdk.open,
    () => '/pinned/claude',
    fakeClaudeProfile,
  )(h.options)
  onTestFinished(() => provider.close())
  await provider.send(h.command)
  await sdk.nextUser()
  const raw = (value: unknown) => sdk.raw(value)
  return {
    ...h,
    sdk,
    provider,
    raw,
    tasks: (ambient = false) =>
      raw({
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [
          {
            task_id: 'watch',
            task_type: 'local_bash',
            description: 'Watch checks',
            ambient,
          },
        ],
      }),
    state: (state: string) =>
      raw({ type: 'system', subtype: 'session_state_changed', state }),
  }
}
