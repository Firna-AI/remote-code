import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { onTestFinished } from 'vitest'

import { object } from '../src/parse'
import type { ProcessPort, StartProcess } from '../src/providers/process'
import type { ProviderOptions } from '../src/providers/types'
import { FakeAppServers } from './app-server'
import { turn } from './input'
import { fakeCodexAccount, fakeToolContext } from './input'

export function codexCredentialFile(directory: string): string {
  return join(directory, 'auth.json')
}

export async function codexTokenFixture(requiredBase?: string) {
  const home = await mkdtemp(join(tmpdir(), 'conductive-codex-token-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const servers = new FakeAppServers()
  const start: StartProcess = (request): ProcessPort => {
    servers.start(request)
    const server = servers.latest
    let receive: (line: string) => void = () => {}
    return {
      write(line) {
        const input = object(JSON.parse(line))
        if (input.method === 'configRequirements/read') {
          server.writes.push(input)
          queueMicrotask(() =>
            receive(
              JSON.stringify({
                id: input.id,
                result: {
                  requirements: requiredBase
                    ? { chatgptBaseUrl: requiredBase }
                    : null,
                },
              }),
            ),
          )
        } else server.write(line)
      },
      onLine(listener) {
        receive = listener
        server.onLine(listener)
      },
      onExit: () => {},
      close: () => server.close(),
    }
  }
  const command = turn('token', 'alice', 'codex')
  command.credential = {
    agent: 'codex',
    kind: 'token',
    token: 'sk-gateway-turn-token',
    account: fakeCodexAccount,
  }
  const options: ProviderOptions = {
    cwd: '/repo',
    home,
    sessionId: command.sessionId,
    endpoint: 'https://machine.test/v1/model/codex',
    credential: { type: 'gateway', ...command.credential },
    commitAuthor: command.commitAuthor,
    choice: command.message.choice,
    conversationId: null,
    instructions: '',
    tools: fakeToolContext,
    event: () => {},
    warn: () => {},
  }
  return { servers, command, options, start }
}
