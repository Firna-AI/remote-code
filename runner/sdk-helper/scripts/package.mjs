// @ts-check
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import './build.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(process.argv[2])

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param {string} destination */
async function dependencies(destination) {
  /** @type {unknown} */
  const lock = JSON.parse(
    await readFile(join(root, 'package-lock.json'), 'utf8'),
  )
  if (!record(lock) || !record(lock.packages))
    throw new Error('Invalid helper lockfile.')
  for (const [path, metadata] of Object.entries(lock.packages)) {
    if (!path || !record(metadata) || metadata.dev === true) continue
    if (!path.startsWith('node_modules/') || path.split('/').includes('..'))
      throw new Error('Invalid helper package path.')
    const source = join(root, path)
    try {
      await stat(source)
    } catch (error) {
      if (
        record(error) &&
        error.code === 'ENOENT' &&
        metadata.optional === true
      )
        continue
      throw new Error('Install helper packages before packaging.')
    }
    await mkdir(dirname(join(destination, path)), { recursive: true })
    await cp(source, join(destination, path), {
      recursive: true,
      filter: (entry) =>
        entry === source ||
        !relative(source, entry).split(sep).includes('node_modules'),
    })
  }
}

if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('Package the helper on Linux x64.')
await mkdir(output, { recursive: true })
const stage = await mkdtemp(join(tmpdir(), 'conductive-sdk-helper-'))
try {
  for (const name of ['package.json', 'package-lock.json'])
    await cp(join(root, name), join(stage, name))
  for (const name of ['sdk-helper', 'measure', 'compare'])
    await cp(
      join(root, `../../dist/sdk-helper/${name}.mjs`),
      join(stage, `${name}.mjs`),
    )
  await dependencies(stage)
  const archive = join(output, 'sdk-helper.tar.gz')
  const tar = spawnSync(
    'tar',
    [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '--mode=u+rwX,go+rX,go-w',
      '--format=gnu',
      '-I',
      'gzip -n',
      '-cf',
      archive,
      '-C',
      stage,
      '.',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  if (tar.error || tar.status !== 0)
    throw new Error('Helper archive creation failed.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  const digest = hash.digest('hex')
  await rename(archive, join(output, `sdk-helper-${digest}.tar.gz`))
  process.stdout.write(`${digest}\n`)
} finally {
  await rm(stage, { recursive: true, force: true })
}
