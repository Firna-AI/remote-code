import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { TOOL_TURN_HEADER } from '../../src/shared/agent-tools'
import type { CommandResult } from '../sandbox/provider'
import { isolatedProcessEnvironment } from '../test-support/process-environment'
import type { backendFixture } from './backend-test-support'
import { shellQuote } from './commands'
import { defaultBranchCommand } from './default-branch-command'
import {
  defaultBranchCredential,
  SENDER_GITHUB_TOKEN,
} from './default-branch-credential-test-support'
import { FakeGitHubGit } from './fake-github-git-test-support'

function run(
  program: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = execFile(
      program,
      args,
      { cwd, env },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error
            ? typeof error.code === 'number'
              ? error.code
              : null
            : 0,
          stdout,
          stderr: stderr || error?.message || '',
          timedOut: false,
        })
      },
    )
    child.stdin?.end()
  })
}

/** Run the shipped command only inside isolated repositories under .context. */
export async function defaultBranchFixture(
  backend: Awaited<ReturnType<typeof backendFixture>>,
) {
  const evidence = resolve(
    import.meta.dirname,
    '../../.context/boat-native-remote-workspaces/milestone-5/decisions-89-91-94/bootstrap/native-git',
  )
  await mkdir(evidence, { recursive: true })
  const root = await realpath(await mkdtemp(join(evidence, "case sender's ")))
  const directory = join(root, "sender's working repository")
  const remote = join(root, 'repository.git')
  const home = join(root, 'home')
  const environment = isolatedProcessEnvironment({
    PATH: '/usr/bin:/bin',
    HOME: home,
    TMPDIR: root,
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CEILING_DIRECTORIES: root,
    GIT_TERMINAL_PROMPT: '0',
  })
  let github: FakeGitHubGit | undefined
  try {
    await mkdir(directory)
    await mkdir(home)
    const checked = async (cwd: string, args: string[]) => {
      const result = await run('git', args, cwd, environment)
      if (result.exitCode !== 0) throw new Error(result.stderr)
      return result.stdout
    }
    const git = (...args: string[]) => checked(directory, args)
    const remoteGit = (...args: string[]) => checked(remote, args)
    await git('init', '--initial-branch=main')
    await git('init', '--bare', '--initial-branch=main', remote)
    await remoteGit('config', 'http.receivepack', 'true')
    const auth = await defaultBranchCredential(backend)
    github = new FakeGitHubGit({
      repository: remote,
      gitExecPath: (await git('--exec-path')).trim(),
      environment,
      issueCredential: auth.issue,
      expectedToken: SENDER_GITHUB_TOKEN,
    })
    const origin = await github.listen()
    const bridge = join(root, 'credential-bridge.mjs')
    await writeFile(
      bridge,
      `if (process.argv[2] === 'get') {
  const response = await fetch(new URL('/credential', process.env.LOCAL_CREDENTIAL_ORIGIN), {
    method: 'POST',
    headers: { ${JSON.stringify(TOOL_TURN_HEADER)}: process.env.CONDUCTIVE_TURN_ID ?? '' },
  })
  if (!response.ok) process.exit(1)
  const value = await response.json()
  process.stdout.write('username=x-access-token\\npassword=' + value.token + '\\n\\n')
}
`,
    )
    await git('remote', 'add', 'origin', `${origin}/repository.git`)
    await git(
      'config',
      'credential.helper',
      `!${shellQuote(process.execPath)} ${shellQuote(bridge)}`,
    )
    const command = () =>
      defaultBranchCommand({
        directory,
        defaultBranch: 'main',
        turnId: auth.turnId,
        sender: auth.sender,
      })
    const createRemoteCommit = async (
      ref = 'refs/heads/main',
      options: { parent?: string; message?: string } = {},
    ) => {
      const tree = (await checked(remote, ['mktree'])).trim()
      const result = await run(
        'git',
        [
          'commit-tree',
          tree,
          ...(options.parent ? ['-p', options.parent] : []),
          '-m',
          options.message ?? 'Existing remote commit',
        ],
        remote,
        {
          ...environment,
          GIT_AUTHOR_NAME: 'Existing Author',
          GIT_COMMITTER_NAME: 'Existing Author',
          GIT_AUTHOR_EMAIL: 'existing@example.test',
          GIT_COMMITTER_EMAIL: 'existing@example.test',
          GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z',
        },
      )
      if (result.exitCode !== 0) throw new Error(result.stderr)
      const commit = result.stdout.trim()
      await remoteGit('update-ref', ref, commit)
      return commit
    }
    return {
      root,
      directory,
      github,
      auth,
      git,
      remoteGit,
      command,
      createRemoteCommit,
      execute: (script = command()) =>
        run('/bin/sh', ['-c', script], directory, {
          ...environment,
          LOCAL_CREDENTIAL_ORIGIN: origin,
        }),
      write: (name: string, text: string) =>
        writeFile(join(directory, name), text),
      config: () => readFile(join(directory, '.git/config'), 'utf8'),
      dispose: async () => {
        await github?.close()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await github?.close()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
