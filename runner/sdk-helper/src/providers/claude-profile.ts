import { createHash } from 'node:crypto'
import { chmod, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ClaudeProfile {
  directory: string
  name: string
  remove(): Promise<void>
}

export async function writeClaudeProfile(
  home: string,
  sessionId: string,
  endpoint: string,
  token: string,
): Promise<ClaudeProfile> {
  const directory = join(home, '.conductive', 'anthropic')
  const name = `session-${createHash('sha256').update(sessionId).digest('hex')}`
  const configs = join(directory, 'configs')
  const credentials = join(directory, 'credentials')
  await privateDirectory(directory)
  await Promise.all([privateDirectory(configs), privateDirectory(credentials)])
  const credential = join(credentials, `${name}.json`)
  const remove = () => rm(credential, { force: true })
  try {
    await writeFile(
      join(configs, `${name}.json`),
      JSON.stringify({
        base_url: endpoint,
        authentication: { type: 'user_oauth' },
      }),
    )
    const file = await open(credential, 'w', 0o600)
    try {
      await file.chmod(0o600)
      await file.writeFile(JSON.stringify({ access_token: token }))
    } finally {
      await file.close()
    }
  } catch (error) {
    await remove()
    throw error
  }
  return { directory, name, remove }
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

export async function clearClaudeCredentials(home: string): Promise<void> {
  const directory = join(home, '.conductive', 'anthropic', 'credentials')
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return
    throw error
  }
  await Promise.all(
    entries.map((name) =>
      rm(join(directory, name), { recursive: true, force: true }),
    ),
  )
}
