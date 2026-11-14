import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'

import githubScript from '../../image/github-cli.sh?raw'
import { imageTestProcess } from '../tools/image-test-process'
import { shellQuote } from './commands'

/** Exercise the shipped gh wrapper with a credential-command test double. */
export async function githubCliFixture(refused = false) {
  const root = await mkdtemp(join(tmpdir(), 'conductive-gh-'))
  const credential = join(root, 'credential')
  const native = join(root, 'native-gh')
  const wrapper = join(root, 'gh')
  await mkdir(join(root, 'home'))
  await writeFile(
    credential,
    `#!${process.execPath}
if (${String(refused)}) {
  process.stderr.write('GitHub access failed. Try again.\\n')
  process.exitCode = 1
} else {
  process.stdout.write(process.env.CONDUCTIVE_TURN_ID ? 'agent-github-token\\n' : 'owner-github-token\\n')
}
`,
    { mode: 0o755 },
  )
  await writeFile(
    native,
    `#!${process.execPath}
import { readFileSync } from 'node:fs'
process.stdout.write(JSON.stringify({
  args: process.argv.slice(2),
  token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null,
  input: readFileSync(0, 'utf8'),
}))
process.exitCode = 7
`,
    { mode: 0o755 },
  )
  await writeFile(
    wrapper,
    githubScript
      .replaceAll(
        '/usr/local/bin/conductive-git-credential',
        shellQuote(credential),
      )
      .replaceAll('/usr/bin/gh', shellQuote(native)),
    { mode: 0o755 },
  )
  return {
    files: async () => {
      const files = await readdir(root, {
        recursive: true,
        withFileTypes: true,
      })
      return Object.fromEntries(
        await Promise.all(
          files
            .filter((file) => file.isFile())
            .map(async (file) => {
              const path = join(file.parentPath, file.name)
              return [relative(root, path), await readFile(path, 'utf8')]
            }),
        ),
      )
    },
    runGitHub: (
      turnId: string,
      args: readonly string[],
      input = '',
      environment: Readonly<Record<string, string>> = {},
    ) =>
      imageTestProcess('/bin/sh', [wrapper, ...args], input, {
        HOME: join(root, 'home'),
        TMPDIR: root,
        LC_ALL: 'C',
        TZ: 'UTC',
        CONDUCTIVE_TURN_ID: turnId,
        ...environment,
      }),
    dispose: () => rm(root, { recursive: true, force: true }),
  }
}
