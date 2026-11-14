import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { FakeAppServers } from '../../test-support/app-server'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { turn } from '../../test-support/input'
import { fakeToolContext } from '../../test-support/input'
import { deferred } from '../../test-support/runtime'
import { object } from '../parse'
import { createCodexFactory } from './codex'
import * as environment from './environment'
import type { ProcessPort, StartProcess } from './process'

beforeEach(() => {
  mockComputerServer()
  vi.spyOn(environment, 'prepareProviderHome').mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function fixture() {
  const servers = new FakeAppServers()
  const entered = deferred<void>()
  let login = ''
  let completed = false
  let receive: (line: string) => void = () => {}
  const start: StartProcess = (request): ProcessPort => {
    const server = servers.start(request)
    return {
      write: (line) => {
        if (object(JSON.parse(line)).method === 'account/login/start') {
          login = line
          entered.resolve()
        } else server.write(line)
      },
      onLine: (listener) => {
        receive = listener
        server.onLine(listener)
      },
      onExit: (listener) => server.onExit(listener),
      close: () => server.close(),
    }
  }
  const command = turn('login', 'alice', 'codex')
  const options = {
    cwd: '/repo',
    home: '/private-agent-home',
    endpoint: 'https://machines.conductive.test/v1/model/codex',
    credential: { type: 'gateway' as const, ...command.credential },
    sessionId: 'session-1',
    commitAuthor: null,
    choice: command.message.choice,
    conversationId: null,
    instructions: '',
    tools: fakeToolContext,
    event: () => {},
    warn: () => {},
  }
  return {
    servers,
    start,
    entered,
    options,
    login: () => object(JSON.parse(login)),
    complete: () => {
      if (login && !completed) {
        completed = true
        servers.latest.write(login)
      }
    },
    fail: () =>
      receive(
        JSON.stringify({
          id: object(JSON.parse(login)).id,
          error: { code: -32000, message: 'Invalid API key' },
        }),
      ),
  }
}

it('gives Codex its login through private RPC before starting or resuming a thread', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'inherited-api-key')
  vi.stubEnv('CODEX_API_KEY', 'inherited-codex-key')
  for (const conversationId of [null, 'existing-thread']) {
    const h = fixture()
    const opening = createCodexFactory(h.start)({
      ...h.options,
      conversationId,
    })
    onTestFinished(async () => {
      h.complete()
      await (await opening).close()
    })
    await h.entered.promise
    const request = h.servers.requests[0]
    expect(request.args).toContain(
      'model_providers.conductive.base_url="https://machines.conductive.test/v1/model/codex"',
    )
    expect(
      /secret-alice|inherited-api-key|inherited-codex-key/.test(
        JSON.stringify(request.env),
      ),
    ).toBe(false)
    expect(request.args).toContain(
      'model_providers.conductive.requires_openai_auth=true',
    )
    expect(request.args).toContain('cli_auth_credentials_store="ephemeral"')
    expect(request.args.join(' ')).not.toMatch(/env_key|secret-alice/)
    expect(h.login()).toMatchObject({
      method: 'account/login/start',
      params: { type: 'apiKey', apiKey: 'secret-alice' },
    })
    expect(h.servers.latest.writes.map((write) => write.method)).toEqual([
      'initialize',
      'initialized',
    ])
    h.complete()
    const provider = await opening
    expect(h.servers.latest.writes.map((write) => write.method)).toEqual([
      'initialize',
      'initialized',
      'account/login/start',
      conversationId ? 'thread/resume' : 'thread/start',
    ])
    await provider.close()
  }
})

it('closes Codex after a private login failure without opening a thread', async () => {
  const h = fixture()
  const opening = createCodexFactory(h.start)(h.options)
  await h.entered.promise
  expect(h.servers.latest.writes.map((write) => write.method)).toEqual([
    'initialize',
    'initialized',
  ])
  h.fail()
  await expect(opening).rejects.toThrow('Invalid API key')
  expect(h.servers.latest.closed).toBe(true)
  expect(h.servers.latest.writes.map((write) => write.method)).toEqual([
    'initialize',
    'initialized',
  ])
})

it('uses the native measurement endpoint and credential for Codex', async () => {
  vi.stubEnv('CONDUCTIVE_MEASURE_LOGIN', 'native-measure-key')
  const h = fixture()
  const opening = createCodexFactory(h.start)({
    ...h.options,
    endpoint: 'https://api.openai.com/v1',
    credential: {
      type: 'native',
      login: { agent: 'codex', kind: 'api-key', secret: 'native-measure-key' },
    },
  })
  onTestFinished(async () => {
    h.complete()
    await (await opening).close()
  })
  await h.entered.promise
  expect(h.login()).toMatchObject({
    method: 'account/login/start',
    params: { type: 'apiKey', apiKey: 'native-measure-key' },
  })
  expect(h.servers.requests[0].args).toContain(
    'model_providers.conductive.base_url="https://api.openai.com/v1"',
  )
  expect(h.servers.requests[0].args.join(' ')).not.toContain(
    'native-measure-key',
  )
  expect(
    /native-measure-key/.test(JSON.stringify(h.servers.requests[0].env)),
  ).toBe(false)
  h.complete()
  await (await opening).close()
})
