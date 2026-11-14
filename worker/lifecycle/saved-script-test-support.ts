import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { CommandResult } from '../sandbox/provider'
import { isolatedProcessEnvironment } from '../test-support/process-environment'
import { isRecord } from '../http'
import { shellQuote } from './commands'
import { legacyRepositoryDirectory } from './repository-locations'

export const SAVED_BASH_SCRIPT = [
  'set -euo pipefail',
  '[[ ! -o posix ]]',
  `words=('saved script' "Bash's ✓")`,
  `printf '%s|%s|%s|%s\\n' "\${words[*]}" "$PWD" "\${SAVED_TEXT-unset}" "\${CONDUCTIVE_DISK_KEEPALIVE-unset}"`,
].join('\n')

const scriptPaths = {
  install: '/tmp/conductive-install.sh',
  startup: '/run/conductive/startup.sh',
  retention: '/run/conductive/retention-startup.sh',
}
type ScriptKind = keyof typeof scriptPaths

/** Runs only known, harmless scripts inside an isolated temporary sandbox. */
export async function localSavedScriptFixture(
  repositoryId: string,
  mode: 'build' | 'workspace' | 'retention' = 'workspace',
) {
  const root = resolve(
    import.meta.dirname,
    '../../.context/boat-native-remote-workspaces/milestone-5/orchestrator-round-2/saved-bash/local-scripts',
  )
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'case-'))
  const repository = join(directory, 'repository')
  const runtime = join(directory, 'runtime')
  const environment = join(directory, 'env.sh')
  const runnerCalls = join(directory, 'runner-calls')
  const systemGitConfig = join(directory, 'system-gitconfig')
  const install = join(directory, 'install.sh')
  const software = join(directory, 'software')
  const mappedPaths = new Map([
    [legacyRepositoryDirectory(repositoryId), repository],
    ['/run/conductive', runtime],
    ['/opt/conductive', software],
    ['/run/ascii-secrets/env.sh', environment],
    [scriptPaths.install, install],
    ['/home/user/code', join(directory, 'code')],
    ['/tmp/conductive-lifecycle', join(directory, 'command-journal')],
  ])
  await mkdir(repository)
  await mkdir(join(software, 'current'), { recursive: true })
  await writeFile(join(software, 'current/conductive'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  })
  await writeFile(
    environment,
    mode === 'build'
      ? ''
      : [
          `CONDUCTIVE_REPOSITORY_DIR=${shellQuote(repository)}`,
          `CONDUCTIVE_DISK_KEEPALIVE=${shellQuote(mode === 'retention' ? '1' : '0')}`,
          `SAVED_TEXT='loaded value'`,
        ].join('\n'),
    { mode: 0o600 },
  )
  const pathPattern = new RegExp(
    [...mappedPaths.keys()]
      .map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'g',
  )
  function mapCommandPaths(text: string): string {
    const marker = '__CONDUCTIVE_ISOLATED_SCRIPT_ROOT__'
    return text
      .replaceAll(directory, marker)
      .replace(pathPattern, (path: string) => mappedPaths.get(path) ?? path)
      .replaceAll(marker, directory)
  }
  function mapPath(path: string): string {
    const mapped = mapCommandPaths(path)
    if (!mapped.startsWith(`${directory}/`))
      throw new Error('A script path leaves its isolated sandbox')
    return mapped
  }
  async function readOptional(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    }
  }
  return {
    directory,
    repository,
    writeBuildEnvironment: async (values: unknown) => {
      if (!isRecord(values)) throw new Error('Missing image environment')
      const lines: string[] = []
      for (const [name, value] of Object.entries(values)) {
        if (typeof value !== 'string') throw new Error('Invalid image variable')
        const mapped = value.startsWith('/home/user/') ? mapPath(value) : value
        if (mapped.startsWith(`${directory}/`))
          await mkdir(mapped, { recursive: true })
        lines.push(`${name}=${shellQuote(mapped)}`)
      }
      await writeFile(environment, lines.join('\n'), { mode: 0o600 })
    },
    contains: (command: string, kind: ScriptKind) =>
      command.includes(scriptPaths[kind]),
    run: async (
      command: string,
      onOutput?: (text: string) => void,
    ): Promise<CommandResult> => {
      let mapped = command
        .replaceAll(
          'sudo -n install -d -m 700 -o user -g user /run/conductive',
          'install -d -m 700 /run/conductive',
        )
        .replaceAll(
          'sudo -n flock /run/conductive/bootstrap-activate.lock systemctl restart conductive-runner.service',
          `printf "%s\\n" runner-restarted >> "${runnerCalls}"`,
        )
        .replaceAll('sudo -n -- /bin/sh -c ', '/bin/sh -c ')
        .replaceAll(
          'sudo -n git config --system ',
          `git config --file ${shellQuote(systemGitConfig)} `,
        )
      mapped = mapCommandPaths(mapped)
      const unmapped = mapped.replaceAll(directory, '<isolated-sandbox>')
      if (/\/(?:run|opt|home\/user|tmp|\.git)(?:\/|\b)/.test(unmapped))
        throw new Error('A script command keeps a production path')
      if (mapped.includes(scriptPaths.install) || mapped.includes('sudo '))
        throw new Error('A script command keeps an unmapped operation')
      return new Promise((resolve, reject) => {
        const child = execFile(
          '/bin/sh',
          ['-c', mapped],
          {
            cwd: directory,
            env: isolatedProcessEnvironment({
              PATH: '/usr/bin:/bin',
              HOME: directory,
              LC_ALL: 'C',
              TZ: 'UTC',
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: '/dev/null',
              GIT_CEILING_DIRECTORIES: directory,
            }),
          },
          (error, stdout, stderr) => {
            const exitCode = error ? error.code : 0
            if (typeof exitCode !== 'number') return reject(error)
            resolve({ exitCode, stdout, stderr, timedOut: false })
          },
        )
        child.stdout?.on('data', (chunk: Buffer) =>
          onOutput?.(chunk.toString()),
        )
      })
    },
    file: (name: string) => readOptional(join(directory, name)),
    buildJournal: async (buildId: string) => {
      const path = join(
        directory,
        'command-journal',
        'build',
        encodeURIComponent(buildId),
      )
      try {
        await stat(path)
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return null
        throw error
      }
      return { stdout: await readOptional(join(path, 'install', 'stdout')) }
    },
    gate: async () => {
      const path = join(directory, 'continue-script')
      await new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/mkfifo', [path], (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      let released = false
      return {
        path,
        release: async () => {
          if (released) return
          released = true
          await writeFile(path, 'continue\n')
        },
      }
    },
    script: async (kind: ScriptKind) => {
      const path = mapPath(scriptPaths[kind])
      const text = await readOptional(path)
      return text === null
        ? null
        : { text, mode: (await stat(path)).mode & 0o777 }
    },
    ready: () => readOptional(join(runtime, 'workspace-ready')),
    runnerCalls: () => readOptional(runnerCalls),
    /** The Git system settings that the scripts wrote, as `git config --list` gives them. */
    systemGitSettings: async () =>
      (await readOptional(systemGitConfig)) === null
        ? null
        : new Promise<string>((resolve, reject) => {
            execFile(
              'git',
              ['config', '--file', systemGitConfig, '--list'],
              { env: isolatedProcessEnvironment({ PATH: '/usr/bin:/bin' }) },
              (error, stdout) => (error ? reject(error) : resolve(stdout)),
            )
          }),
    dispose: () => rm(directory, { recursive: true, force: true }),
  }
}
