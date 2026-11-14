import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { homedir } from 'node:os'
import type { RunnerLogin } from './generated/RunnerLogin'
import type { RunnerMessageDuringTurn } from './generated/RunnerMessageDuringTurn'
import { oneOf } from './parse'
import { warmClaude } from './providers/binaries'
import { createClaudeFactory } from './providers/claude'
import { createCodexFactory } from './providers/codex'
import type { ProviderProcess } from './providers/types'
import type { ProviderEvent } from './generated/ProviderEvent'

/** One sample per real resume. The default mode reads binary bytes only. */
async function measure(): Promise<void> {
  // performance.now starts with the Node process, before static SDK imports.
  const began = 0
  const mode = oneOf(process.env.CONDUCTIVE_MEASURE_MODE ?? 'warm-only', [
    'warm-only',
    'agent',
  ])
  const warmBegan = performance.now()
  const bytes = await warmClaude()
  const warmMs = performance.now() - warmBegan
  if (mode === 'warm-only') {
    process.stdout.write(
      `${JSON.stringify({ environment: 'local-warm-only', measuredAt: new Date().toISOString(), bytes, warmMs, limit: 'No resume or agent start was measured.' })}\n`,
    )
    return
  }
  const placement = oneOf(process.env.CONDUCTIVE_MEASURE_PLACEMENT, [
    'home',
    'system',
  ])
  const resumeId = process.env.CONDUCTIVE_MEASURE_RESUME_ID
  const secret = process.env.CONDUCTIVE_MEASURE_LOGIN
  if (!resumeId || !secret)
    throw new Error('Set the resume ID and measurement login.')
  const agent = oneOf(process.env.CONDUCTIVE_MEASURE_AGENT, ['claude', 'codex'])
  const kind =
    agent === 'codex'
      ? 'api-key'
      : oneOf(process.env.CONDUCTIVE_MEASURE_LOGIN_KIND, ['token', 'api-key'])
  const login: RunnerLogin =
    agent === 'codex'
      ? { agent, kind: 'api-key', secret }
      : { agent, kind, secret }
  const factory =
    agent === 'claude' ? createClaudeFactory() : createCodexFactory()
  let firstProviderEventMs: number | null = null
  let firstTextMs: number | null = null
  let resolve: (ok: boolean) => void = () => {}
  const finished = new Promise<boolean>((yes) => {
    resolve = yes
  })
  const event = (event: ProviderEvent) => {
    firstProviderEventMs ??= performance.now() - began
    if (event.type === 'delta' || event.type === 'answer')
      firstTextMs ??= performance.now() - began
    if (event.type === 'result') resolve(event.state === 'finished')
    if (event.type === 'failed') resolve(false)
  }
  let provider: ProviderProcess | null = null
  const timer = setTimeout(() => resolve(false), 120_000)
  try {
    const choice = {
      agent,
      model: process.env.CONDUCTIVE_MEASURE_MODEL ?? '',
      effort: 'low' as const,
      fast: false,
    }
    if (!choice.model) throw new Error('Set the measurement model.')
    const turnId = randomUUID()
    const sessionId = randomUUID()
    provider = await factory({
      cwd: process.env.CONDUCTIVE_REPOSITORY ?? process.cwd(),
      home: process.env.CONDUCTIVE_HOME ?? homedir(),
      sessionId,
      endpoint:
        agent === 'claude'
          ? 'https://api.anthropic.com'
          : 'https://api.openai.com/v1',
      credential: { type: 'native', login },
      commitAuthor: null,
      choice,
      conversationId: null,
      instructions: '',
      tools: {
        machineOrigin: process.env.CONDUCTIVE_MACHINE_ORIGIN ?? '',
        workspaceToken: process.env.CONDUCTIVE_WORKSPACE_TOKEN ?? '',
        turnId,
      },
      event,
      warn: (message) => process.stderr.write(`${message}\n`),
    })
    const command: RunnerMessageDuringTurn = {
      type: 'message',
      commandId: randomUUID(),
      sessionId,
      turnId,
      attachments: [],
      message: {
        id: randomUUID(),
        sessionId,
        sender: {
          id: 'measurement',
          githubLogin: 'measurement',
          displayName: null,
          avatarUrl: null,
        },
        text: 'Reply with only the word ready.',
        attachments: [],
        choice,
        createdAt: Date.now(),
        state: 'sent',
      },
    }
    await provider.send(command)
    if (!(await finished))
      throw new Error('The measured agent turn did not finish.')
    process.stdout.write(
      `${JSON.stringify({ environment: 'operator-resumed-sandbox', measuredAt: new Date().toISOString(), placement, resumeId, agent, model: choice.model, runner: import.meta.url, warmMs, firstProviderEventMs, firstTextMs, totalMs: performance.now() - began })}\n`,
    )
  } finally {
    clearTimeout(timer)
    await provider?.close()
  }
}

void measure().catch(() => {
  process.stderr.write(
    'The first-start measurement failed. Check its inputs and agent access.\n',
  )
  process.exitCode = 1
})
