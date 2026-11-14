import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import type { Agent } from '../src/generated/Agent'
import type { ProviderEvent } from '../src/generated/ProviderEvent'
import type { ProviderOptions } from '../src/providers/types'
import { fakeToolContext, turn } from './input'

export async function providerFixture(agent: Agent = 'claude') {
  const home = await mkdtemp(join(tmpdir(), 'conductive-adapter-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const events: ProviderEvent[] = []
  const warnings: string[] = []
  const command = turn('1', 'alice', agent)
  const options: ProviderOptions = {
    cwd: home,
    home,
    sessionId: command.sessionId,
    endpoint: `${fakeToolContext.machineOrigin}/v1/model/${agent}`,
    credential: { type: 'gateway', ...command.credential },
    commitAuthor: null,
    choice: command.message.choice,
    conversationId: null,
    instructions: '',
    tools: fakeToolContext,
    event: (event) => {
      events.push(event)
    },
    warn: (warning) => {
      warnings.push(warning)
    },
  }
  return { root: home, home, events, warnings, command, options }
}
