#!/usr/bin/env node
// @ts-check
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(
  new URL('../runner/sdk-helper/package.json', import.meta.url),
)
const { build } = require('esbuild')
const output = join(root, '.context/chat-live-check/cli.mjs')

try {
  process.umask(0o077)
  await mkdir(dirname(output), { recursive: true })
  await build({
    absWorkingDir: root,
    entryPoints: ['image/live-main.ts'],
    outfile: output,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    nodePaths: [
      join(root, 'runner/node_modules'),
      join(root, 'runner/sdk-helper/node_modules'),
    ],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  await import(pathToFileURL(output).href)
} catch {
  process.stderr.write(
    'The live check could not start. Install the SDK helper and live-check packages and check the image scripts.\n',
  )
  process.exitCode = 1
}
