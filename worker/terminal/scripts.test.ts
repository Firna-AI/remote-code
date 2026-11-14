import {
  chmod,
  mkdir,
  readdir,
  readFile,
  writeFile,
  unlink,
} from 'node:fs/promises'

import { expect, it } from 'vitest'

import { shellArgument } from './privileged'
import {
  credentialScript,
  launcherScript,
  sessionServerScript,
  terminalPromptCommand,
} from './scripts'
import {
  runInteractiveBash,
  runScript,
  scriptFixture,
} from './scripts.test-support'

it('creates and reuses a local runtime credential without new entropy and keeps separate runtime storage', async () => {
  const first = await scriptFixture()
  expect((await runScript(credentialScript(first.options))).code).toBe(0)
  expect(await readdir(first.options.runtimeDirectory)).toContain('password')
  expect(await first.readPassword()).toBe('11'.repeat(32))
  expect(await readFile(first.capturedEntropy)).toEqual(Buffer.alloc(32, 17))
  await writeFile(first.entropyInput, Buffer.alloc(32, 34))
  expect((await runScript(credentialScript(first.options))).code).toBe(0)
  expect(await first.readPassword()).toBe('11'.repeat(32))
  expect(await readFile(first.calls, 'utf8')).toBe('called\n')
  const second = {
    ...first.options,
    runtimeDirectory: `${first.root}/second runtime`,
  }
  expect((await runScript(credentialScript(second))).code).toBe(0)
  expect(await readFile(`${second.runtimeDirectory}/password`, 'utf8')).toBe(
    '22'.repeat(32),
  )
  expect(await first.readPassword()).toBe('11'.repeat(32))
})

it('refuses missing, unreadable, and empty runtime passwords before executing the terminal', async () => {
  const fixture = await scriptFixture()
  const missing = await runScript(launcherScript(fixture.options))
  expect(missing.code).not.toBe(0)
  expect(await readdir(fixture.root)).not.toContain('started')
  await runScript(credentialScript(fixture.options))
  const valid = await runScript(launcherScript(fixture.options), true)
  expect(valid.code).toBe(0)
  expect(await readdir(fixture.root)).toContain('started')
  await unlink(`${fixture.root}/started`)
  await writeFile(`${fixture.options.runtimeDirectory}/password`, '')
  const empty = await runScript(launcherScript(fixture.options))
  expect(empty.code).not.toBe(0)
  expect(await readdir(fixture.root)).not.toContain('started')
  await writeFile(
    `${fixture.options.runtimeDirectory}/password`,
    '11'.repeat(32),
  )
  await chmod(`${fixture.options.runtimeDirectory}/password`, 0)
  const unreadable = await runScript(launcherScript(fixture.options), true)
  expect(unreadable.code).not.toBe(0)
  expect(await readdir(fixture.root)).not.toContain('started')
})

it('fails credential generation without installing an empty password when the entropy command fails', async () => {
  const fixture = await scriptFixture()
  const result = await runScript(
    credentialScript({ ...fixture.options, entropyCommand: ['/bin/false'] }),
  )
  expect(result.code).not.toBe(0)
  expect(await readdir(fixture.options.runtimeDirectory)).not.toContain(
    'password',
  )
  expect(result.stdout).toBe('')
})

it('loads the workspace environment and opens the terminal in its repository', async () => {
  const fixture = await scriptFixture()
  await writeFile(
    fixture.terminal,
    `#!/bin/sh
printf '%s\\n' "$PWD" "$CONDUCTIVE_LAUNCH_TEST"
`,
  )
  expect((await runScript(credentialScript(fixture.options))).code).toBe(0)
  const result = await runScript(launcherScript(fixture.options))
  expect(result).toEqual({
    code: 0,
    stdout: `${fixture.repository}\nworkspace environment\n`,
    stderr: '',
  })
})

it('attaches each terminal connection to the workspace shell at the repository path without starting its own server', async () => {
  const fixture = await scriptFixture()
  await writeFile(
    fixture.terminal,
    `#!/bin/sh
printf '%s\\0' "$@"
`,
  )
  expect((await runScript(credentialScript(fixture.options))).code).toBe(0)
  const result = await runScript(launcherScript(fixture.options))
  expect(result.code).toBe(0)
  expect(result.stdout.split('\0').slice(0, -1)).toEqual([
    '--interface',
    '0.0.0.0',
    '--port',
    '7681',
    '--writable',
    '--credential',
    `conductive:${'11'.repeat(32)}`,
    fixture.multiplexer,
    '-N',
    '-S',
    fixture.sessionSocket,
    'new-session',
    '-A',
    '-s',
    'workspace',
    '-c',
    fixture.repository,
    '/bin/bash',
    '-l',
  ])
})

it('starts the workspace shell server with the repository environment and private socket', async () => {
  const fixture = await scriptFixture()
  const result = await runScript(sessionServerScript(fixture.options))
  expect(result.code).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain(fixture.options.restoreMarker)
  expect(result.stdout.split('\0').slice(0, -1)).toEqual([
    fixture.repository,
    'workspace environment',
    '-S',
    fixture.sessionSocket,
    '-f',
    '/dev/null',
    'start-server',
    ';',
    'set-option',
    '-s',
    'exit-empty',
    'off',
    ';',
    'set-option',
    '-g',
    'mouse',
    'on',
    ';',
    'set-environment',
    '-g',
    'PROMPT_COMMAND',
    terminalPromptCommand(fixture.options.restoreMarker),
  ])
})

it('waits for the restore marker before moving a running shell once and keeps OLDPWD', async () => {
  const fixture = await scriptFixture()
  const folder = `${fixture.repository}/src`
  const oldView = `${fixture.root}/old view`
  const laterView = `${fixture.root}/later view`
  await mkdir(folder)
  await mkdir(fixture.options.runtimeDirectory)
  await writeFile(`${folder}/old file`, '')
  const result = await runInteractiveBash(
    [
      `cd ${shellArgument(folder)}`,
      `mv ${shellArgument(fixture.repository)} ${shellArgument(oldView)} && mkdir -p ${shellArgument(folder)} && : > ${shellArgument(`${folder}/live file`)}`,
      'ls',
      `: > ${shellArgument(fixture.options.restoreMarker)}`,
      'ls',
      'printf "%s\\n" "$OLDPWD"',
      `mv ${shellArgument(fixture.repository)} ${shellArgument(laterView)} && mkdir -p ${shellArgument(folder)} && : > ${shellArgument(`${folder}/later file`)}`,
      'ls',
      'printf "%s\\n" "$OLDPWD"',
      'env | cut -d= -f1 | grep "^__conductive_" || :',
      'exit',
    ],
    {
      folder: fixture.repository,
      home: fixture.root,
      promptCommand: terminalPromptCommand(fixture.options.restoreMarker),
    },
  )
  expect(result.code).toBe(0)
  expect(result.stdout).toBe(
    `old file\nlive file\n${fixture.repository}\nlive file\n${fixture.repository}\n`,
  )
  expect(result.stderr).not.toContain('PROMPT_COMMAND')
})
