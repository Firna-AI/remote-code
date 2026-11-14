import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { Agent } from '../../src/shared/generated/Agent'
import { ACCOUNT_PATHS, agentLoginPath } from '../../src/shared/account'
import { GET_STARTED_PATH } from '../../src/shared/onboarding'
import { agentLoginContext } from '../chat/queries'
import { decrypt } from '../security/crypto'
import {
  createHarness,
  TEST_TIME,
  type TestHarness,
} from '../test-support/harness'

let harness: TestHarness
beforeAll(async () => {
  harness = await createHarness()
})
beforeEach(async () => {
  await harness.reset()
  harness.env.CONDUCTIVE_DEFAULT_CHOICE = JSON.stringify({
    agent: 'claude',
    model: 'test-claude',
    effort: 'high',
    fast: false,
  })
})
afterAll(async () => harness.dispose())

const endpoint = 'https://proxy.example.test:8443/private/v1/?key=value#part'

function save(cookie: string, agent: Agent, address = endpoint) {
  return harness.request(agentLoginPath(agent), cookie, {
    method: 'PUT',
    body: JSON.stringify({
      agent,
      kind: 'endpoint',
      endpoint: ` \n${address}\t `,
      secret: ' wrapped\n key ',
    }),
  })
}

it.each(['claude', 'codex'] as const)(
  'encrypts the %s endpoint and key together and returns only account metadata',
  async (agent) => {
    const cookie = await harness.login()
    const saved = await save(cookie, agent)
    expect(saved.status).toBe(200)
    const metadata = {
      agent,
      connected: true,
      kind: 'endpoint',
      host: 'proxy.example.test:8443',
      noReuse: false,
      updatedAt: TEST_TIME,
    }
    expect(await saved.json()).toEqual(metadata)
    const account = await harness.request(ACCOUNT_PATHS.account, cookie)
    const body = await account.text()
    expect(JSON.parse(body)).toMatchObject({
      agentLogins: expect.arrayContaining([metadata]),
    })
    expect(body).not.toMatch(/wrapped|password|private\/v1|key=value/)
    expect(body).not.toContain(endpoint)
    expect(
      await (await harness.request(GET_STARTED_PATH, cookie)).json(),
    ).toMatchObject({
      steps: expect.arrayContaining([{ step: 'agent-login', complete: true }]),
    })
    const row = await harness.env.DB.prepare(
      'SELECT user_id AS userId, ciphertext, endpoint_origin AS origin, no_reuse AS noReuse FROM agent_logins WHERE agent = ?',
    )
      .bind(agent)
      .first<{
        userId: string
        ciphertext: string
        origin: string
        noReuse: number
      }>()
    if (!row) throw new Error('The login was not saved.')
    expect(row.origin).toBe('https://proxy.example.test:8443')
    expect(row.noReuse).toBe(0)
    expect(row.ciphertext).not.toContain(endpoint)
    expect(row.ciphertext).not.toContain('wrappedkey')
    expect(
      JSON.parse(
        await decrypt(
          row.ciphertext,
          agentLoginContext(row.userId, agent),
          harness.env.BOAT_KEY_ENCRYPTION_KEY,
        ),
      ),
    ).toEqual({
      endpoint:
        agent === 'claude'
          ? 'https://proxy.example.test:8443/private?key=value'
          : 'https://proxy.example.test:8443/private/v1?key=value',
      secret: 'wrappedkey',
    })
  },
)

it('preserves the saved host name login when an IP, non-public, or malformed replacement is refused', async () => {
  const cookie = await harness.login()
  const accepted = await save(
    cookie,
    'codex',
    'https://136.115.241.64.sslip.io/v1',
  )
  expect(accepted.status).toBe(200)
  const metadata = {
    agent: 'codex',
    connected: true,
    kind: 'endpoint',
    host: '136.115.241.64.sslip.io',
    noReuse: false,
    updatedAt: TEST_TIME,
  }
  expect(await accepted.json()).toEqual(metadata)
  for (const address of [
    'https://8.8.8.8',
    'https://[2606:4700:4700::1111]',
    'http://proxy.example.test/v1',
    'http://localhost:8787/v1',
    'https://192.168.1.1',
    'https://metadata.google.internal',
    'https://api.conductive.build',
    'https://user:password@proxy.example.test',
    'not a URL',
    'ftp://localhost/v1',
  ]) {
    const refused = await save(cookie, 'codex', address)
    expect(refused.status, address).toBe(400)
    expect(await refused.json()).toEqual({
      error: {
        code: 'invalid_endpoint',
        message:
          'Use a public https:// address with a host name, without a user name or a password.',
      },
    })
  }
  expect(
    await (await harness.request(ACCOUNT_PATHS.account, cookie)).json(),
  ).toMatchObject({
    agentLogins: [{ agent: 'claude', connected: false }, metadata],
  })
})

it('preserves endpoint sharing on rotation and takes the new kind default on a kind change', async () => {
  const cookie = await harness.login()
  const path = agentLoginPath('claude')
  const put = (kind: 'token' | 'api-key') =>
    harness.request(path, cookie, {
      method: 'PUT',
      body: JSON.stringify({ agent: 'claude', kind, secret: 'direct-key' }),
    })
  expect(await (await put('token')).json()).toMatchObject({ noReuse: true })
  expect(await (await save(cookie, 'claude')).json()).toMatchObject({
    noReuse: false,
  })
  expect(
    await (
      await harness.request(path, cookie, {
        method: 'PATCH',
        body: JSON.stringify({ noReuse: true }),
      })
    ).json(),
  ).toMatchObject({ noReuse: true })
  expect(
    await (
      await save(cookie, 'claude', 'https://rotated.example.test:443/')
    ).json(),
  ).toMatchObject({
    noReuse: true,
    host: 'rotated.example.test',
  })
  expect(await (await put('api-key')).json()).toEqual({
    agent: 'claude',
    connected: true,
    kind: 'api-key',
    noReuse: false,
    updatedAt: TEST_TIME,
  })
  expect(
    await harness.env.DB.prepare(
      'SELECT endpoint_origin FROM agent_logins',
    ).first('endpoint_origin'),
  ).toBeNull()
  expect(await (await save(cookie, 'claude')).json()).toMatchObject({
    noReuse: false,
  })
  expect(await (await put('token')).json()).toMatchObject({ noReuse: true })
})

it('refuses the configured preview domain and its subdomains at save', async () => {
  const cookie = await harness.login()
  const previous = harness.env.PREVIEW_DOMAIN
  harness.env.PREVIEW_DOMAIN = 'custom-previews.example.test'
  try {
    for (const address of [
      'https://custom-previews.example.test',
      'https://port.custom-previews.example.test:8443/v1',
    ]) {
      const response = await save(cookie, 'claude', address)
      expect(response.status, address).toBe(400)
      expect(await response.json()).toEqual({
        error: {
          code: 'invalid_endpoint',
          message:
            'Use a public https:// address with a host name, without a user name or a password.',
        },
      })
    }
  } finally {
    harness.env.PREVIEW_DOMAIN = previous
  }
})
