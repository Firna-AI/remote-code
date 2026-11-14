import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { onTestFinished } from 'vitest'

import { isolatedProcessEnvironment } from '../test-support/process-environment'
import type { CommandResult } from '../sandbox/provider'
import { FakeGitHubGit } from './fake-github-git-test-support'
import { shellQuote } from './commands'
import {
  continueFetchCommand,
  continueBranchCommand,
  continueMoveCommand,
  continueStagingDirectory,
} from './continue-commands'
import { localWorkCommand, localWorkResult } from './local-work'

export async function continueNativeFixture(trackIgnored = false) {
  const parent = resolve('.context/pull-request-bar-actions/milestone-7/native')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'case-'))
  const home = join(root, 'home')
  const directory = join(home, "working repo's folder")
  const seed = join(root, 'seed')
  const remote = join(root, 'repository.git')
  await mkdir(directory, { recursive: true })
  await mkdir(seed)
  const env = isolatedProcessEnvironment({
    PATH: '/usr/bin:/bin',
    HOME: home,
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Author',
    GIT_AUTHOR_EMAIL: 'author@example.test',
    GIT_COMMITTER_NAME: 'Author',
    GIT_COMMITTER_EMAIL: 'author@example.test',
    GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z',
  })
  const run = (
    program: string,
    args: string[],
    cwd = directory,
  ): Promise<CommandResult> =>
    new Promise((resolve) => {
      const child = execFile(
        program,
        args,
        { cwd, env },
        (error, stdout, stderr) =>
          resolve({
            exitCode: error
              ? typeof error.code === 'number'
                ? error.code
                : null
              : 0,
            stdout,
            stderr: stderr || error?.message || '',
            timedOut: false,
          }),
      )
      child.stdin?.end()
    })
  const checked = async (cwd: string, args: string[]) => {
    const result = await run('/usr/bin/git', args, cwd)
    if (result.exitCode !== 0) throw new Error(result.stderr)
    return result.stdout
  }
  const git = (...args: string[]) => checked(directory, args)
  const seedGit = (...args: string[]) => checked(seed, args)
  const remoteGit = (...args: string[]) => checked(remote, args)
  await seedGit('init', '--quiet', '--initial-branch=main')
  await seedGit('init', '--quiet', '--bare', '--initial-branch=main', remote)
  for (const [file, content] of Object.entries({
    'carry.txt': 'original\n',
    'staged.txt': 'original\n',
    'clash.txt': 'original\n',
    '.gitignore': 'ignored.txt\n',
  }))
    await writeFile(join(seed, file), content)
  await seedGit('add', '.')
  await seedGit('commit', '--quiet', '-m', 'Base')
  await seedGit('push', '--quiet', remote, 'main')
  await git('init', '--quiet', '--initial-branch=owner/old')
  await git('remote', 'add', 'origin', remote)
  await git('fetch', '--quiet', 'origin')
  await git('checkout', '--quiet', '-B', 'owner/old', 'origin/main')
  await writeFile(join(seed, 'base.txt'), 'latest base\n')
  await writeFile(join(seed, 'clash.txt'), 'new base content\n')
  if (trackIgnored) {
    await writeFile(join(seed, 'ignored.txt'), 'new tracked base content\n')
    await seedGit('add', '-f', 'ignored.txt')
  }
  await seedGit('add', '.')
  await seedGit('commit', '--quiet', '-m', 'Merged base')
  await seedGit('push', '--quiet', remote, 'main')
  const latest = (await seedGit('rev-parse', 'HEAD')).trim()
  const credentialIds: string[] = []
  const token = 'clicking-member-test-token'
  const server = new FakeGitHubGit({
    repository: remote,
    environment: env,
    gitExecPath: (await git('--exec-path')).trim(),
    expectedToken: token,
    issueCredential: async (id) => {
      credentialIds.push(id)
      return Response.json({ token })
    },
  })
  const origin = await server.listen()
  onTestFinished(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const helper = join(root, 'legacy-helper')
  await writeFile(
    helper,
    `#!${process.execPath}\nif (process.argv[2] === 'get') {\nconst response = await fetch(${JSON.stringify(`${origin}/credential`)}, { method: 'POST', headers: { 'X-Conductive-Turn-Id': process.env.CONDUCTIVE_TURN_ID ?? '' } });\nconst { token } = await response.json();\nprocess.stdout.write('username=x-access-token\\npassword=' + token + '\\n\\n');\n}\n`,
  )
  await chmod(helper, 0o700)
  const job = {
    id: 'continue-one',
    fetchId: 'trusted-continue-fetch',
    baseBranch: 'main',
    branch: 'owner/new',
    directory,
    binding: {
      id: 'workspace',
      orgId: 'org',
      branch: 'owner/old',
      repositoryId: 1,
      fullName: 'example/repository',
      defaultBranch: 'main',
      installationId: 1,
    },
  }
  // Only the HOME of the command is the home of the cloud computer. The
  // fixture folders can also start with /home/user, in a checkout there.
  const map = (command: string) =>
    command
      .replaceAll('HOME=/home/user ', `HOME=${shellQuote(home)} `)
      .replaceAll('/tmp/conductive-continue', join(root, 'continuations'))
      .replaceAll('/usr/local/bin/conductive-git-credential', helper)
      .replaceAll(
        'https://github.com/example/repository.git',
        `${origin}/repository.git`,
      )
  const execute = (command: string) => run('/bin/sh', ['-c', map(command)])
  return {
    root,
    home,
    directory,
    job,
    latest,
    token,
    server,
    credentialIds,
    git,
    remoteGit,
    write: (file: string, content: string) =>
      writeFile(join(directory, file), content),
    read: (file: string) => readFile(join(directory, file), 'utf8'),
    fetch: () => execute(continueFetchCommand(job)),
    branch: () => execute(continueBranchCommand(job)),
    move: () => execute(continueMoveCommand(job)),
    work: async () => {
      const result = await execute(localWorkCommand(directory))
      if (result.exitCode !== 0) throw new Error(result.stderr)
      return localWorkResult(result.stdout)
    },
    stageConfig: () =>
      readFile(join(map(continueStagingDirectory(job.id)), 'config'), 'utf8'),
    command: () => continueFetchCommand(job),
    execute,
    quote: shellQuote,
  }
}
