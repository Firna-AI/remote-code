import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { continueNativeFixture } from './continue-native.test-support'

it('keeps the fetched comparison base current after Continue and its default rename', async () => {
  for (const baseBranch of ['main', 'trunk']) {
    const f = await continueNativeFixture()
    await f.git('branch', 'main', 'origin/main')
    await f.git(
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
    )
    await f.git('config', 'branch.owner/old.gh-merge-base', 'main')
    const old = await f.git('rev-parse', 'main')
    expect(await f.git('diff', 'origin/main...HEAD', '--', 'clash.txt')).toBe(
      '',
    )
    await f.git('fetch', '--quiet', 'origin')
    expect(await f.git('diff', 'origin/main...HEAD', '--', 'clash.txt')).toBe(
      '',
    )
    expect(await f.git('show', 'HEAD:clash.txt')).toBe('original\n')
    if (baseBranch === 'trunk') {
      await f.remoteGit('update-ref', 'refs/heads/trunk', f.latest)
      await f.remoteGit('update-ref', '-d', 'refs/heads/main')
      await f.remoteGit('symbolic-ref', 'HEAD', 'refs/heads/trunk')
    }
    f.job.baseBranch = baseBranch
    expect((await f.fetch()).exitCode).toBe(0)
    expect((await f.move()).exitCode).toBe(0)
    expect(await f.git('symbolic-ref', 'refs/remotes/origin/HEAD')).toBe(
      `refs/remotes/origin/${baseBranch}\n`,
    )
    expect(await f.git('diff', `origin/${baseBranch}...HEAD`)).toBe('')
    expect(await f.git('status', '--porcelain')).toBe('')
    expect(await f.git('show', `origin/${baseBranch}:clash.txt`)).toBe(
      'new base content\n',
    )
    expect(await f.git('show', 'HEAD:clash.txt')).toBe('new base content\n')
    expect(await f.git('rev-parse', 'main')).toBe(old)
    expect(await f.git('branch', '--show-current')).toBe('owner/new\n')
    expect(
      await f.git(
        'config',
        '--local',
        '--get-regexp',
        '^branch\\.owner/new\\.',
      ),
    ).toBe(`branch.owner/new.gh-merge-base ${baseBranch}\n`)
  }
})

it('repairs default metadata after a switched move loses its result without another checkout', async () => {
  const f = await continueNativeFixture()
  await f.git(
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  )
  await f.remoteGit('update-ref', 'refs/heads/trunk', f.latest)
  f.job.baseBranch = 'trunk'
  expect((await f.fetch()).exitCode).toBe(0)
  await f.write('.git/refs/remotes/origin/HEAD.lock', 'held metadata lock\n')
  await f.write('.git/config.lock', 'held target metadata lock\n')
  expect((await f.move()).exitCode).not.toBe(0)
  expect(await f.git('branch', '--show-current')).toBe('owner/new\n')
  expect((await f.branch()).exitCode).not.toBe(0)
  expect(await f.git('symbolic-ref', 'refs/remotes/origin/HEAD')).toBe(
    'refs/remotes/origin/main\n',
  )
  const branches = await f.git(
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    'refs/heads/',
  )
  await rm(join(f.directory, '.git/refs/remotes/origin/HEAD.lock'))
  expect((await f.branch()).exitCode).not.toBe(0)
  await rm(join(f.directory, '.git/config.lock'))
  expect(await f.branch()).toEqual({
    exitCode: 0,
    stdout: 'owner/new\n',
    stderr: '',
    timedOut: false,
  })
  expect(await f.git('symbolic-ref', 'refs/remotes/origin/HEAD')).toBe(
    'refs/remotes/origin/trunk\n',
  )
  expect(await f.git('config', 'branch.owner/new.gh-merge-base')).toBe(
    'trunk\n',
  )
  expect(
    await f.git(
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads/',
    ),
  ).toBe(branches)
  expect(await f.git('diff', 'origin/trunk...HEAD')).toBe('')
  expect(await f.git('status', '--porcelain')).toBe('')
})
