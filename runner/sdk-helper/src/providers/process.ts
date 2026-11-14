import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import { ProviderLifetime } from './lifetime'

export interface ProcessPort {
  write(line: string): void
  onLine(listener: (line: string) => void): void
  onExit(listener: () => void): void
  close(): void | Promise<void>
}

export interface ProcessRequest {
  command: string
  args: readonly string[]
  cwd: string
  env: Record<string, string | undefined>
  signal?: AbortSignal
  lifetime?: ProviderLifetime
}

export type StartProcess = (request: ProcessRequest) => ProcessPort

export const startProcess: StartProcess = (request) => {
  const lifetime = request.lifetime ?? new ProviderLifetime()
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const completion = lifetime.register(child)
  const lines = createInterface({ input: child.stdout })
  const exits = new Set<() => void>()
  let exited = false
  const exit = () => {
    if (exited) return
    exited = true
    for (const listener of exits) listener()
  }
  child.on('exit', exit)
  child.on('error', exit)
  child.stdin.on('error', exit)
  const abort = () => {
    void lifetime.close()
  }
  request.signal?.addEventListener('abort', abort, { once: true })
  void completion.then(() =>
    request.signal?.removeEventListener('abort', abort),
  )
  if (request.signal?.aborted) abort()
  return {
    write: (line) => {
      if (exited) throw new Error('The agent process ended.')
      child.stdin.write(`${line}\n`)
    },
    onLine: (listener) => {
      lines.on('line', listener)
    },
    onExit: (listener) => {
      exits.add(listener)
      if (exited) listener()
    },
    close: async () => {
      lines.close()
      child.stdin.end()
      await lifetime.close()
      child.stdout.destroy()
    },
  }
}
