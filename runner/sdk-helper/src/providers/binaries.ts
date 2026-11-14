import { createRequire } from 'node:module'
import { open } from 'node:fs/promises'

import { object } from '../parse'

const require = createRequire(import.meta.url)

export function claudeBinary(): string {
  const header = object(object(process.report.getReport()).header)
  const platform = `${process.platform}-${process.arch}${process.platform === 'linux' && header.glibcVersionRuntime === undefined ? '-musl' : ''}`
  return require.resolve(
    `@anthropic-ai/claude-agent-sdk-${platform}/claude${process.platform === 'win32' ? '.exe' : ''}`,
  )
}

export function codexBinary(): string {
  return require.resolve('@openai/codex/bin/codex.js')
}

/** Reading bytes warms disk pages. This starts no SDK and uses no login. */
export async function warmClaude(): Promise<number> {
  const file = await open(claudeBinary(), 'r')
  const buffer = Buffer.alloc(1024 * 1024)
  let bytes = 0
  try {
    for (;;) {
      const result = await file.read(buffer)
      if (!result.bytesRead) return bytes
      bytes += result.bytesRead
    }
  } finally {
    await file.close()
  }
}
