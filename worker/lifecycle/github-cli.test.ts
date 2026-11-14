import { expect, it } from 'vitest'

import { githubCliFixture } from './github-cli-test-support'

it('authenticates each GitHub CLI invocation afresh and preserves arguments, input, and exit status', async () => {
  const launcher = await githubCliFixture()
  try {
    const before = await launcher.files()
    const args = [
      'issue',
      'create',
      '--title',
      "A title's text",
      '--body-file',
      '-',
    ]
    const terminal = await launcher.runGitHub('', args, 'An issue body\n')
    expect(terminal.exitCode, terminal.stderr).toBe(7)
    expect(JSON.parse(terminal.stdout)).toEqual({
      args,
      token: 'owner-github-token',
      input: 'An issue body\n',
    })
    const agent = await launcher.runGitHub('current-turn', ['pr', 'list'])
    expect(agent.exitCode, agent.stderr).toBe(7)
    expect(JSON.parse(agent.stdout)).toEqual({
      args: ['pr', 'list'],
      token: 'agent-github-token',
      input: '',
    })
    const version = await launcher.runGitHub('', ['--version'])
    expect(JSON.parse(version.stdout)).toEqual({
      args: ['--version'],
      token: null,
      input: '',
    })
    const supplied = await launcher.runGitHub('', ['issue', 'list'], '', {
      GITHUB_TOKEN: 'user-supplied-token',
    })
    expect(JSON.parse(supplied.stdout)).toEqual({
      args: ['issue', 'list'],
      token: 'user-supplied-token',
      input: '',
    })
    expect(await launcher.files()).toEqual(before)
  } finally {
    await launcher.dispose()
  }
})

it('stops the GitHub CLI when authentication fails and keeps credentials out of errors', async () => {
  const launcher = await githubCliFixture(true)
  try {
    const cases = [
      { args: ['issue', 'list'], free: false },
      { args: ['issue', 'list', '--help'], free: true },
      { args: ['issue', '--help'], free: true },
      { args: ['pr', 'create', '--help'], free: true },
      { args: ['issue', 'list', '--state=open', '--help'], free: true },
      { args: ['issue', 'create', '--title', '--help'], free: false },
      { args: ['auth', 'status', '-h', 'github.com'], free: false },
      { args: ['-h', 'github.com', 'auth', 'status'], free: false },
      { args: ['issue', 'list', '--', '--help'], free: false },
      { args: ['extension', 'exec', 'tool', '--help'], free: false },
    ]
    for (const { args, free } of cases) {
      const result = await launcher.runGitHub('', args)
      expect(result.exitCode, args.join(' ')).toBe(free ? 7 : 1)
      expect(result.stdout, args.join(' ')).toBe(
        free ? JSON.stringify({ args, token: null, input: '' }) : '',
      )
      expect(result.stderr, args.join(' ')).toBe(
        free ? '' : 'GitHub access failed. Try again.\n',
      )
    }
  } finally {
    await launcher.dispose()
  }
})
