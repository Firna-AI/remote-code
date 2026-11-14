import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'

import { object, string } from '../src/parse'

export class FakeChild extends ChildProcess {
  override stdin = new PassThrough()
  override stdout = new PassThrough()
  override stderr = new PassThrough()
  override stdio: ChildProcess['stdio'] = [
    this.stdin,
    this.stdout,
    this.stderr,
    new PassThrough(),
    null,
  ]
  override pid = 1
  override killed = false
  override exitCode: number | null = null
  override signalCode: NodeJS.Signals | null = null
  readonly signals: (NodeJS.Signals | number)[] = []
  rpc = false
  holdMethod: string | null = null
  exitOnSignal: NodeJS.Signals | null = null
  onRequest: (method: string) => void = () => {}
  onKill: () => void = () => {}
  private turns = 0

  constructor() {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      if (!this.rpc) return
      const value: unknown = JSON.parse(chunk.toString('utf8'))
      const request = object(value)
      const method = string(request.method)
      this.onRequest(method)
      if (request.id === undefined || method === this.holdMethod) return
      let result: unknown = {}
      if (method === 'thread/start' || method === 'thread/resume')
        result = { thread: { id: 'codex-conversation' } }
      if (method === 'turn/start')
        result = { turn: { id: `codex-turn-${++this.turns}` } }
      queueMicrotask(() => {
        this.stdout.write(JSON.stringify({ id: request.id, result }) + '\n')
      })
    })
  }

  override kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.signals.push(signal)
    this.killed = true
    this.onKill()
    if (signal === this.exitOnSignal) this.exit(null, this.exitOnSignal)
    return true
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
    this.stdout.end()
    this.stderr.end()
  }
}
