import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readdir,
  readlink,
  rm,
  symlink,
} from 'node:fs/promises'
import { join } from 'node:path'
import type { RunnerCodexAccount } from '../generated/RunnerCodexAccount'

export interface CodexCredentials {
  directory: string
  remove(): Promise<void>
}

export function codexStorageHome(home: string): string {
  return join(home, '.conductive', 'codex')
}

function sessionHomes(home: string): string {
  return join(codexStorageHome(home), 'session-homes')
}

export async function writeCodexCredentials(
  home: string,
  sessionId: string,
  token: string,
  account: RunnerCodexAccount,
): Promise<CodexCredentials> {
  const name = `session-${createHash('sha256').update(sessionId).digest('hex')}`
  const directory = join(sessionHomes(home), name)
  await privateDirectory(sessionHomes(home))
  await privateDirectory(directory)
  for (const name of ['sessions', 'archived_sessions']) {
    const target = join(codexStorageHome(home), name)
    const link = join(directory, name)
    await privateDirectory(target)
    try {
      await symlink(target, link, 'dir')
    } catch (error) {
      if (!hasCode(error, 'EEXIST') || (await readlink(link)) !== target)
        throw error
    }
  }
  const credential = join(directory, 'auth.json')
  const remove = () => rm(credential, { force: true })
  try {
    const file = await open(credential, 'w', 0o600)
    try {
      await file.chmod(0o600)
      await file.writeFile(
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          tokens: {
            id_token: identityToken(account),
            access_token: token,
            refresh_token: 'conductive-worker-renews-chatgpt',
            account_id: account.accountId,
          },
          last_refresh: '9999-12-31T23:59:59Z',
        }),
      )
    } finally {
      await file.close()
    }
  } catch (error) {
    await remove()
    throw error
  }
  return { directory, remove }
}

function identityToken(account: RunnerCodexAccount): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    email: account.email,
    'https://api.openai.com/auth': {
      chatgpt_account_id: account.accountId,
      chatgpt_plan_type: account.planType,
      chatgpt_user_id: account.userId,
    },
  })}.conductive`
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export async function clearCodexCredentials(home: string): Promise<void> {
  let sessions
  try {
    sessions = await readdir(sessionHomes(home), { withFileTypes: true })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return
    throw error
  }
  await Promise.all(
    sessions
      .filter((session) => session.isDirectory())
      .map(async (session) => {
        const directory = join(sessionHomes(home), session.name)
        const files = await readdir(directory)
        await Promise.all(
          files
            .filter((name) => name === 'auth.json' || name.startsWith('.auth-'))
            .map((name) => rm(join(directory, name), { force: true })),
        )
      }),
  )
}
