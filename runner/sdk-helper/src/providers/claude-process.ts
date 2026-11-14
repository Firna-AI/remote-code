import { spawn } from 'node:child_process'
import { Writable } from 'node:stream'
import type {
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import type { RunnerLogin } from '../generated/RunnerLogin'
import type { ProviderLifetime } from './lifetime'

export function spawnClaudeProcess(
  request: SpawnOptions,
  login: RunnerLogin | null,
  lifetime: ProviderLifetime,
): SpawnedProcess {
  const descriptor =
    login &&
    (login.kind === 'token'
      ? 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'
      : 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR')
  const child = spawn(request.command, request.args, {
    cwd: request.cwd,
    env: descriptor ? { ...request.env, [descriptor]: '3' } : request.env,
    stdio: login
      ? ['pipe', 'pipe', 'ignore', 'pipe']
      : ['pipe', 'pipe', 'ignore'],
  })
  const exited = lifetime.register(child)
  const credential = child.stdio[3]
  const { stdin, stdout } = child
  if (!stdin || !stdout || (login && !(credential instanceof Writable))) {
    void lifetime.close()
    throw new Error('The agent login pipe is unavailable.')
  }
  if (!login || !(credential instanceof Writable))
    return Object.assign(child, { stdin, stdout })
  credential.once('error', () => {
    credential.destroy()
    void lifetime.close()
  })
  credential.once('finish', () => credential.destroy())
  void exited.then(() => credential.destroy())
  try {
    credential.end(`${login.secret}\n`)
  } catch (error) {
    credential.destroy()
    void lifetime.close()
    throw error
  }
  return Object.assign(child, { stdin, stdout })
}
