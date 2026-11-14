import { symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
await build({
  absWorkingDir: root,
  entryPoints: {
    'sdk-helper': 'src/main.ts',
    measure: 'src/measure.ts',
    compare: 'src/compare.ts',
  },
  outdir: '../../dist/sdk-helper',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
})
try {
  await symlink(
    '../../runner/sdk-helper/node_modules',
    `${root}/../../dist/sdk-helper/node_modules`,
    'dir',
  )
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
    throw error
}
