import { vi } from 'vitest'

import type { HelperOptions } from '../src/generated/HelperOptions'
import type { HelperOutput } from '../src/generated/HelperOutput'
import type { HelperRequest } from '../src/generated/HelperRequest'
import type { ProviderFactory } from '../src/providers/types'
import { HelperSession } from '../src/session'
import { fakeToolContext, turn } from './input'
import { FakeProviders } from './providers'
import { deferred } from './runtime'

export function sessionFixture(factory?: ProviderFactory) {
  const providers = new FakeProviders()
  const command = turn()
  const options: HelperOptions = {
    cwd: '/repo',
    home: '/private/home',
    sessionId: command.sessionId,
    endpoint: 'https://machine.test/v1/model/claude',
    credential: { type: 'gateway', ...command.credential },
    commitAuthor: { name: 'Alice', email: 'alice@example.test' },
    choice: { ...command.message.choice, fast: true },
    conversationId: 'saved-conversation',
    instructions: 'Saved instructions',
    tools: fakeToolContext,
    backgroundNoteIds: ['task:old'],
  }
  const output: HelperOutput[] = []
  const pending: ((message: HelperOutput) => void)[] = []
  const ended = deferred<void>()
  const finish = vi.fn(() => ended.resolve())
  const session = new HelperSession(
    { claude: factory ?? providers.open, codex: providers.open },
    (message) => {
      output.push(message)
      if (message.type === 'response' || message.type === 'error') {
        pending.shift()?.(message)
      }
    },
    async () => {},
    finish,
  )
  function request(request: HelperRequest): Promise<HelperOutput> {
    const reply = deferred<HelperOutput>()
    pending.push(reply.resolve)
    session.accept(request)
    return reply.promise
  }
  return {
    providers,
    command,
    options,
    output,
    session,
    ended: ended.promise,
    finish,
    request,
    start: () => request({ type: 'start', requestId: 'start', options }),
  }
}
