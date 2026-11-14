import { Buffer } from 'node:buffer'

import { expect, it } from 'vitest'

import { setupBackendTests } from './backend-test-hooks'
import { SENDER_GITHUB_TOKEN } from './default-branch-credential-test-support'
import { defaultBranchFixture } from './default-branch-test-support'

const backendFixture = setupBackendTests()

it('pushes an empty root as the turn sender without staged files and fetches it once again on retry', async () => {
  const fixture = await defaultBranchFixture(await backendFixture())
  try {
    expect(await fixture.remoteGit('for-each-ref')).toBe('')
    await fixture.write(
      'install-output.txt',
      'Keep staged installation output\n',
    )
    await fixture.git('add', 'install-output.txt')
    const config = await fixture.config()
    const result = await fixture.execute()
    expect(result.exitCode, result.stderr).toBe(0)
    const commit = (
      await fixture.remoteGit('rev-parse', 'refs/heads/main')
    ).trim()
    expect(await fixture.git('rev-parse', 'FETCH_HEAD')).toBe(`${commit}\n`)
    await fixture.git('checkout', '--quiet', '-b', 'owner/first', 'FETCH_HEAD')
    expect(await fixture.git('merge-base', 'origin/main', 'HEAD')).toBe(
      `${commit}\n`,
    )
    expect(await fixture.git('status', '--porcelain')).toBe(
      'A  install-output.txt\n',
    )
    expect(
      await fixture.git(
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads/main',
      ),
    ).toBe('')
    expect(await fixture.remoteGit('rev-list', '--count', 'main')).toBe('1\n')
    expect(await fixture.remoteGit('show', '-s', '--format=%P', 'main')).toBe(
      '\n',
    )
    expect(
      await fixture.remoteGit('ls-tree', '-r', '--name-only', 'main'),
    ).toBe('')
    expect(
      await fixture.remoteGit(
        'show',
        '-s',
        '--format=%an <%ae>%n%cn <%ce>%n%s',
        'main',
      ),
    ).toBe(
      'Trusted Sender <18+teammate@users.noreply.github.com>\nTrusted Sender <18+teammate@users.noreply.github.com>\nInitialize empty repository\n',
    )
    expect(await fixture.git('diff', '--cached', '--name-only')).toBe(
      'install-output.txt\n',
    )
    const pushed = fixture.github.requests.filter((request) =>
      request.path.endsWith('/git-receive-pack'),
    )
    expect(pushed.map((request) => request.authorization)).toEqual([
      `Basic ${Buffer.from(`x-access-token:${SENDER_GITHUB_TOKEN}`).toString('base64')}`,
    ])
    expect(fixture.auth.turns).toEqual([
      fixture.auth.turnId,
      fixture.auth.turnId,
      fixture.auth.turnId,
    ])
    expect((await fixture.execute()).exitCode).toBe(0)
    expect(await fixture.remoteGit('rev-parse', 'main')).toBe(`${commit}\n`)
    expect(
      fixture.github.requests.filter((request) =>
        request.path.endsWith('/git-receive-pack'),
      ),
    ).toHaveLength(1)
    expect(await fixture.config()).toBe(config)
    expect(fixture.command()).not.toContain(SENDER_GITHUB_TOKEN)
    expect(config).not.toContain(SENDER_GITHUB_TOKEN)
  } finally {
    await fixture.dispose()
  }
})

it('fetches normal history without a push', async () => {
  const fixture = await defaultBranchFixture(await backendFixture())
  try {
    const older = await fixture.createRemoteCommit()
    expect((await fixture.execute()).exitCode).toBe(0)
    await fixture.git('branch', 'main', 'refs/remotes/origin/main')
    const commit = await fixture.createRemoteCommit('refs/heads/main', {
      message: 'Updated remote commit',
    })
    const result = await fixture.execute()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(await fixture.git('rev-parse', 'FETCH_HEAD')).toBe(`${commit}\n`)
    await fixture.git('checkout', '--quiet', '-b', 'owner/new', 'FETCH_HEAD')
    expect(await fixture.git('merge-base', 'origin/main', 'HEAD')).toBe(
      `${commit}\n`,
    )
    expect(await fixture.git('rev-parse', 'main')).toBe(`${older}\n`)
    expect(await fixture.remoteGit('rev-parse', 'main')).toBe(`${commit}\n`)
    expect(
      fixture.github.requests.filter((request) =>
        request.path.includes('git-receive-pack'),
      ),
    ).toEqual([])
  } finally {
    await fixture.dispose()
  }
})

it('does not bootstrap a missing default branch when the remote has another ref', async () => {
  const fixture = await defaultBranchFixture(await backendFixture())
  try {
    const commit = await fixture.createRemoteCommit('refs/tags/existing')
    const result = await fixture.execute()
    expect(result.exitCode).toBe(128)
    expect(
      await fixture.remoteGit(
        'for-each-ref',
        '--format=%(objectname) %(refname)',
      ),
    ).toBe(`${commit} refs/tags/existing\n`)
    expect(
      fixture.github.requests.filter((request) =>
        request.path.includes('git-receive-pack'),
      ),
    ).toEqual([])
  } finally {
    await fixture.dispose()
  }
})

it('fetches a concurrent first commit without replacing it and keeps it on retry', async () => {
  const fixture = await defaultBranchFixture(await backendFixture())
  try {
    let winner = ''
    fixture.github.beforeReceive = async () => {
      winner = await fixture.createRemoteCommit()
    }
    const result = await fixture.execute()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(await fixture.git('rev-parse', 'FETCH_HEAD')).toBe(`${winner}\n`)
    expect(await fixture.remoteGit('rev-parse', 'main')).toBe(`${winner}\n`)
    expect(await fixture.remoteGit('show', '-s', '--format=%an', 'main')).toBe(
      'Existing Author\n',
    )
    expect((await fixture.execute()).exitCode).toBe(0)
    expect(await fixture.remoteGit('rev-parse', 'main')).toBe(`${winner}\n`)
  } finally {
    await fixture.dispose()
  }
})

it.each(['denied', 'unavailable'] as const)(
  'does not create a commit when remote inspection is %s',
  async (failure) => {
    const fixture = await defaultBranchFixture(await backendFixture())
    try {
      fixture.github.readFailure = failure
      const result = await fixture.execute()
      expect(result.exitCode).toBe(128)
      expect(await fixture.remoteGit('for-each-ref')).toBe('')
      expect(
        fixture.github.requests.filter((request) =>
          request.path.includes('git-receive-pack'),
        ),
      ).toEqual([])
    } finally {
      await fixture.dispose()
    }
  },
)

it('fails when the first push is denied and the remote stays empty', async () => {
  const fixture = await defaultBranchFixture(await backendFixture())
  try {
    fixture.github.denyPush = true
    const result = await fixture.execute()
    expect(result.exitCode).toBe(128)
    expect(await fixture.remoteGit('for-each-ref')).toBe('')
    expect(
      fixture.github.requests
        .filter((request) => request.path.includes('git-receive-pack'))
        .map((request) => request.method),
    ).toEqual(['GET', 'GET'])
  } finally {
    await fixture.dispose()
  }
})
