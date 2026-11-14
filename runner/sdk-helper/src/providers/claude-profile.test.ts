import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, onTestFinished } from 'vitest'

import { clearClaudeCredentials, writeClaudeProfile } from './claude-profile'

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'conductive-profile-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const directory = join(home, '.conductive', 'anthropic')
  return { home, directory }
}

function paths(directory: string, name: string) {
  return {
    config: join(directory, 'configs', `${name}.json`),
    credential: join(directory, 'credentials', `${name}.json`),
  }
}

it('writes the gateway and turn token into private separate profile files', async () => {
  const h = await fixture()
  const profile = await writeClaudeProfile(
    h.home,
    'session/alice',
    'https://machines.conductive.test/v1/model/claude',
    'sk-ant-api-turn-alice',
  )
  const files = paths(profile.directory, profile.name)
  expect(await readFile(files.config, 'utf8').catch(() => null)).toBe(
    JSON.stringify({
      base_url: 'https://machines.conductive.test/v1/model/claude',
      authentication: { type: 'user_oauth' },
    }),
  )
  expect(profile.directory).toBe(h.directory)
  expect(await readFile(files.credential, 'utf8')).toBe(
    JSON.stringify({ access_token: 'sk-ant-api-turn-alice' }),
  )
  expect((await stat(files.credential)).mode & 0o777).toBe(0o600)
  expect((await stat(profile.directory)).mode & 0o777).toBe(0o700)
  expect(
    (await stat(join(profile.directory, 'credentials'))).mode & 0o777,
  ).toBe(0o700)
  await chmod(files.credential, 0o644)
  await chmod(profile.directory, 0o755)
  await chmod(join(profile.directory, 'credentials'), 0o755)
  const next = await writeClaudeProfile(
    h.home,
    'session/alice',
    'https://machines.conductive.test/v1/model/claude',
    'next-turn-token',
  )
  expect(next.name).toBe(profile.name)
  expect((await stat(files.credential)).mode & 0o777).toBe(0o600)
  expect((await stat(profile.directory)).mode & 0o777).toBe(0o700)
  expect(
    (await stat(join(profile.directory, 'credentials'))).mode & 0o777,
  ).toBe(0o700)
  expect(await readFile(files.credential, 'utf8')).toBe(
    JSON.stringify({ access_token: 'next-turn-token' }),
  )
})

it('gives concurrent sessions distinct safe names and removes only their own credential', async () => {
  const h = await fixture()
  const [alice, bob] = await Promise.all([
    writeClaudeProfile(
      h.home,
      '../session/alice',
      'https://gateway/claude',
      'alice-token',
    ),
    writeClaudeProfile(
      h.home,
      '.._session_alice',
      'https://gateway/claude',
      'bob-token',
    ),
  ])
  expect(alice.name).not.toBe(bob.name)
  expect(alice.name).toMatch(/^[A-Za-z0-9_.-]+$/)
  expect(bob.name).toMatch(/^[A-Za-z0-9_.-]+$/)
  expect(
    await readFile(paths(alice.directory, alice.name).credential, 'utf8'),
  ).toBe('{"access_token":"alice-token"}')
  expect(
    await readFile(paths(bob.directory, bob.name).credential, 'utf8'),
  ).toBe('{"access_token":"bob-token"}')
  await alice.remove()
  await alice.remove()
  expect(
    await readFile(paths(alice.directory, alice.name).credential, 'utf8').catch(
      () => null,
    ),
  ).toBe(null)
  expect(
    await readFile(paths(bob.directory, bob.name).credential, 'utf8'),
  ).toBe('{"access_token":"bob-token"}')
  expect(
    await readFile(paths(alice.directory, alice.name).config, 'utf8'),
  ).toContain('https://gateway/claude')
})

it('removes private stale credentials and keeps project credentials', async () => {
  const h = await fixture()
  const stale = join(h.directory, 'credentials')
  await mkdir(stale, { recursive: true })
  await writeFile(join(stale, 'old-session.json'), 'old-token')
  await mkdir(join(stale, 'old-session.json.lock'))
  const project = join(h.home, '.anthropic', 'credentials')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'default.json'), 'project-token')
  await clearClaudeCredentials(h.home)
  expect(await readdir(stale)).toEqual([])
  expect(await readFile(join(project, 'default.json'), 'utf8')).toBe(
    'project-token',
  )
})
