import { expect, it } from 'vitest'

import { createApp } from '../application'
import type { AppEnv } from '../env'
import { setupBackendTests } from '../lifecycle/backend-test-hooks'
import { TEST_TIME } from '../test-support/harness'
import { sha256Hex } from './digest'

const fixtureForTest = setupBackendTests()
const path = '/v1/deploy/software-image'
const token = 'deploy-test-token'

async function routeFixture() {
  const { images, boat } = fixtureForTest()
  const digest = await sha256Hex(token)
  const env: AppEnv = {
    ...images.env,
    CONDUCTIVE_DEPLOY_TOKEN_SHA256: digest,
    CF_VERSION_METADATA: {
      id: 'worker-version',
      timestamp: new Date(TEST_TIME).toISOString(),
      tag: 'version',
    },
  }
  const app = createApp(images.dependencies)
  const request = (
    input: {
      token?: string | null
      digest?: string
      headers?: HeadersInit
      method?: string
      origin?: string
    } = {},
  ) => {
    const headers = new Headers(input.headers)
    headers.set('Content-Type', 'application/json')
    if (input.token !== null)
      headers.set('Authorization', `Bearer ${input.token ?? token}`)
    return app.fetch(
      new Request(`${input.origin ?? env.MACHINE_ORIGIN}${path}`, {
        method: input.method ?? 'POST',
        headers,
        ...(input.method === 'GET'
          ? {}
          : { body: JSON.stringify({ tokenDigest: input.digest ?? digest }) }),
      }),
      env,
    )
  }
  return { env, request, images, boat, digest }
}

it('accepts only the deploy token for the current Worker during its 30-minute window', async () => {
  const { request, images, boat } = await routeFixture()
  expect((await request({ token: null })).status).toBe(401)
  expect((await request({ token: 'wrong' })).status).toBe(401)
  expect(
    (await request({ token: 'wrong', digest: 'b'.repeat(64) })).status,
  ).toBe(409)
  await fixtureForTest().setTime(TEST_TIME + 30 * 60 * 1000 + 1)
  expect((await request()).status).toBe(401)
  expect(boat.starts).toEqual([])
  expect(
    await images.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM software_images',
    ).first('count'),
  ).toBe(0)
})

it('refuses browser headers first and hides an unavailable or invalid version binding', async () => {
  const { env, request, boat } = await routeFixture()
  expect(
    (await request({ headers: { Cookie: 'session=browser' } })).status,
  ).toBe(403)
  expect(
    (await request({ headers: { Origin: env.MACHINE_ORIGIN ?? '' } })).status,
  ).toBe(403)
  expect((await request({ method: 'GET' })).status).toBe(404)
  const metadata = env.CF_VERSION_METADATA
  delete env.CF_VERSION_METADATA
  expect((await request()).status).toBe(404)
  expect(
    (await request({ headers: { Origin: 'https://other.test' } })).status,
  ).toBe(403)
  env.CF_VERSION_METADATA = { id: 'bad-version', timestamp: 'invalid', tag: '' }
  expect((await request()).status).toBe(404)
  env.CF_VERSION_METADATA = metadata
  delete env.CONDUCTIVE_DEPLOY_TOKEN_SHA256
  expect((await request()).status).toBe(404)
  expect(boat.starts).toEqual([])
})

it('advances the current runner build and returns only private state and new output', async () => {
  const { request, boat, env } = await routeFixture()
  boat.commandRunning = true
  const first = await request()
  expect(first.status).toBe(200)
  expect(first.headers.get('Cache-Control')).toBe('no-store')
  expect(first.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(await first.json()).toMatchObject({
    state: 'building',
    phase: 'software',
    output: 'installing...\n',
  })
  expect(await (await request()).json()).toMatchObject({
    state: 'building',
    output: '',
  })
  boat.commandRunning = false
  expect(await (await request()).json()).toMatchObject({
    state: 'ready',
    phase: 'done',
    output: '',
  })
  expect(boat.starts).toHaveLength(1)
  const rows = await env.DB.prepare('SELECT * FROM software_images').all()
  expect(JSON.stringify(rows)).not.toContain(token)
  expect(boat.commands.join('\n')).not.toContain(token)
})

it('returns the same failure to its deploy run and starts again for another deploy run', async () => {
  const { request, boat, env } = await routeFixture()
  boat.commandExitCode = 1
  const failed = await request()
  expect(failed.status).toBe(200)
  expect(await failed.json()).toMatchObject({
    state: 'failed',
    error: 'The software image build failed.',
    keptOutput: 'installing...\n',
  })
  expect(await (await request()).json()).toMatchObject({
    state: 'failed',
    output: '',
  })
  expect(boat.starts).toHaveLength(1)
  const nextToken = 'next-deploy-test-token'
  const nextDigest = await sha256Hex(nextToken)
  env.CONDUCTIVE_DEPLOY_TOKEN_SHA256 = nextDigest
  boat.commandExitCode = 0
  expect(
    await (await request({ token: nextToken, digest: nextDigest })).json(),
  ).toMatchObject({ state: 'ready' })
  expect(boat.starts).toHaveLength(2)
})
