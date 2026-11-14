import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { Codex } from '@openai/codex-sdk'

// A one-time capability probe. It uses the installed SDK and its real CLI.
// Every inference request goes to this local fake Responses server.
const home = await mkdtemp(join(tmpdir(), 'conductive-codex-capability-'))
let releaseResponse = () => {}
let requested = () => {}
let finishResponse = Promise.resolve()
let requestCount = 0
const server = createServer(async (request, response) => {
  requestCount++
  for await (const chunk of request) void chunk
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (type, data) =>
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
    )
  const item = {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    content: [],
  }
  send('response.created', {
    response: { id: 'resp_fake', status: 'in_progress', output: [] },
  })
  send('response.output_item.added', { output_index: 0, item })
  send('response.content_part.added', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  })
  send('response.output_text.delta', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: 'Hello ',
  })
  requested()
  await finishResponse
  send('response.output_text.delta', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: 'world',
  })
  const completed = {
    ...item,
    content: [{ type: 'output_text', text: 'Hello world', annotations: [] }],
  }
  send('response.output_text.done', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    text: 'Hello world',
  })
  send('response.output_item.done', { output_index: 0, item: completed })
  send('response.completed', {
    response: {
      id: 'resp_fake',
      status: 'completed',
      output: [completed],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    },
  })
  response.end()
})

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('No local server port.')
  const sdk = new Codex({
    apiKey: 'fake-local-only-key',
    env: { HOME: home, CODEX_HOME: home, PATH: process.env.PATH ?? '' },
    config: {
      model_provider: 'probe',
      model_providers: {
        probe: {
          name: 'probe',
          base_url: `http://127.0.0.1:${address.port}`,
          wire_api: 'responses',
          requires_openai_auth: false,
        },
      },
    },
  })
  const options = {
    workingDirectory: home,
    skipGitRepoCheck: true,
    model: 'gpt-5.4',
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
  }
  async function run(abort) {
    const controller = new AbortController()
    const events = []
    const requestStarted = new Promise((resolve) => {
      requested = resolve
    })
    finishResponse = new Promise((resolve) => {
      releaseResponse = resolve
    })
    const stream = await sdk
      .startThread(options)
      .runStreamed('Reply once.', { signal: controller.signal })
    const consuming = (async () => {
      try {
        for await (const event of stream.events) events.push(event)
        return { ended: true }
      } catch (error) {
        return {
          ended: true,
          error: error instanceof Error ? error.name : 'Unknown error',
        }
      }
    })()
    await Promise.race([
      requestStarted,
      delay(5000).then(() => {
        throw new Error('The CLI made no local request.')
      }),
    ])
    await delay(500)
    const beforeCompletion = structuredClone(events)
    if (abort) controller.abort()
    else releaseResponse()
    const outcome = await Promise.race([
      consuming,
      delay(5000).then(() => ({ ended: false })),
    ])
    releaseResponse()
    return { beforeCompletion, events, outcome }
  }
  const completed = await run(false)
  const aborted = await run(true)
  process.stdout.write(
    `${JSON.stringify({ checkedAt: new Date().toISOString(), sdk: '0.167.0', model: options.model, fakeDeltaObservationMs: 500, requestCount, completed, aborted, selection: 'App Server for partial text; SDK AbortSignal interrupts its CLI', limits: 'Local fake inference only. No provider account or real inference was used.' }, null, 2)}\n`,
  )
} finally {
  releaseResponse()
  server.closeAllConnections()
  server.close()
  await rm(home, { recursive: true })
}
