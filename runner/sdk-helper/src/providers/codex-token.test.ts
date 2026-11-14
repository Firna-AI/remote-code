import { readFile } from 'node:fs/promises'

import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import {
  codexCredentialFile,
  codexTokenFixture,
} from '../../test-support/codex-token'
import { mockComputerServer } from '../../test-support/computer-mcp'
import { object } from '../parse'
import { createCodexFactory } from './codex'
import { codexStorageHome } from './codex-credentials'

beforeEach(() => {
  mockComputerServer()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('starts and resumes ChatGPT turns from a credential file through the gateway', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'inherited-real-key')
  vi.stubEnv('CODEX_HOME', '/inherited-home')
  vi.stubEnv('GIT_AUTHOR_NAME', 'Inherited Author')
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'inherited-author@example.test')
  vi.stubEnv('GIT_COMMITTER_NAME', 'Inherited Committer')
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'inherited-committer@example.test')
  const h = await codexTokenFixture(
    'HTTPS://MACHINE.test/v1/model/codex/backend-api/',
  )
  h.options.commitAuthor = {
    name: 'ChatGPT Author',
    email: 'chatgpt-author@example.test',
  }
  const directories: string[] = []
  for (const conversationId of [null, 'saved-thread']) {
    const provider = await createCodexFactory(h.start)({
      ...h.options,
      conversationId,
    })
    onTestFinished(() => provider.close())
    const request = h.servers.requests.at(-1)
    expect({
      GIT_AUTHOR_NAME: request?.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: request?.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: request?.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: request?.env.GIT_COMMITTER_EMAIL,
    }).toEqual({
      GIT_AUTHOR_NAME: 'ChatGPT Author',
      GIT_AUTHOR_EMAIL: 'chatgpt-author@example.test',
      GIT_COMMITTER_NAME: 'ChatGPT Author',
      GIT_COMMITTER_EMAIL: 'chatgpt-author@example.test',
    })
    const codexHome = request?.env.CODEX_HOME ?? ''
    expect(codexHome).not.toBe(codexStorageHome(h.options.home))
    expect(codexHome).toMatch(/\/session-homes\/session-[a-f0-9]{64}$/)
    directories.push(codexHome)
    const auth = object(
      JSON.parse(await readFile(codexCredentialFile(codexHome), 'utf8')),
    )
    const tokens = object(auth.tokens)
    expect({ ...auth, tokens: { ...tokens, id_token: '[synthetic]' } }).toEqual(
      {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: '[synthetic]',
          access_token: 'sk-gateway-turn-token',
          refresh_token: 'conductive-worker-renews-chatgpt',
          account_id: 'chatgpt-account-alice',
        },
        last_refresh: '9999-12-31T23:59:59Z',
      },
    )
    const idToken = String(tokens.id_token).split('.')
    expect(idToken).toHaveLength(3)
    expect(JSON.parse(Buffer.from(idToken[1], 'base64url').toString())).toEqual(
      {
        email: 'alice@example.test',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'chatgpt-account-alice',
          chatgpt_plan_type: 'plus',
          chatgpt_user_id: 'chatgpt-user-alice',
        },
      },
    )
    for (const config of [
      'model_provider="openai"',
      'chatgpt_base_url="https://machine.test/v1/model/codex/backend-api"',
      'openai_base_url="https://machine.test/v1/model/codex/backend-api/codex"',
      'features.enable_request_compression=false',
      'cli_auth_credentials_store="file"',
      `sqlite_home=${JSON.stringify(codexStorageHome(h.options.home))}`,
    ])
      expect(request?.args).toContain(config)
    expect(JSON.stringify(request)).not.toMatch(
      /sk-gateway-turn-token|inherited-real-key|inherited-home/,
    )
    expect(
      Object.keys(request?.env ?? {}).filter((name) =>
        name.startsWith('CODEX_'),
      ),
    ).toEqual(['CODEX_HOME'])
    expect(h.servers.latest.writes.map(({ method }) => method)).toEqual([
      'initialize',
      'initialized',
      'account/read',
      'configRequirements/read',
      conversationId ? 'thread/resume' : 'thread/start',
    ])
    expect(h.servers.latest.writes.at(-1)?.params).toMatchObject({
      modelProvider: 'openai',
      ...(conversationId ? { threadId: 'saved-thread' } : {}),
    })
    await provider.close()
    expect(h.servers.latest.closed).toBe(true)
    expect(
      await readFile(codexCredentialFile(codexHome), 'utf8').catch(() => null),
    ).toBe(null)
  }
  expect(directories).toEqual([directories[0], directories[0]])
})

it('closes a ChatGPT turn and removes its file when a workspace requires another gateway', async () => {
  const h = await codexTokenFixture('https://managed.example/backend-api')
  await expect(createCodexFactory(h.start)(h.options)).rejects.toThrow(
    "This ChatGPT workspace requires another Codex address. Ask its admin to allow Conductive's address.",
  )
  expect(h.servers.latest.closed).toBe(true)
  expect(h.servers.latest.writes.map(({ method }) => method)).toEqual([
    'initialize',
    'initialized',
    'account/read',
    'configRequirements/read',
  ])
  const directory = h.servers.requests[0].env.CODEX_HOME ?? ''
  expect(
    await readFile(codexCredentialFile(directory), 'utf8').catch(() => null),
  ).toBe(null)
})
