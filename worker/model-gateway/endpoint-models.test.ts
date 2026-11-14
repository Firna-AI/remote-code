import { afterEach, expect, it, vi } from 'vitest'
import type { Agent } from '../../src/shared/generated/Agent'
import { FakeModelUpstream } from '../test-support/fake-model-upstream'
import { readEndpointModels } from './endpoint-models'
import { deferred } from './http.test-support'

afterEach(() => vi.useRealTimers())

const login = (agent: Agent = 'claude') => ({
  agent,
  kind: 'endpoint' as const,
  endpoint: 'https://proxy.example.test/edge?key=address-secret#fragment',
  secret: 'fake-key',
})

function upstream() {
  return new FakeModelUpstream(
    'https://proxy.example.test',
    ['/edge/v1/models', '/edge/models'],
    () =>
      Response.json({
        data: [
          { id: 'claude-opus-5-5', display_name: 'Opus' },
          { id: 'gpt-6.1-sol', object: 'model' },
        ],
      }),
    'GET',
  )
}

it.each(['claude', 'codex'] as const)(
  'reads %s IDs through the builder with only its key header',
  async (agent) => {
    const fake = upstream()
    expect(await readEndpointModels(login(agent), fake.fetch)).toEqual([
      'claude-opus-5-5',
      'gpt-6.1-sol',
    ])
    expect(fake.requests).toHaveLength(1)
    const request = fake.requests[0]
    expect(request.url).toBe(
      `https://proxy.example.test/edge${agent === 'claude' ? '/v1/models' : '/models'}?key=address-secret${agent === 'claude' ? '&limit=1000' : ''}`,
    )
    expect(request.redirect).toBe('manual')
    expect(request.headers.get('x-api-key')).toBe(
      agent === 'claude' ? 'fake-key' : null,
    )
    expect(request.headers.get('authorization')).toBe(
      agent === 'codex' ? 'Bearer fake-key' : null,
    )
    expect(request.headers.get('anthropic-version')).toBe(
      agent === 'claude' ? '2023-06-01' : null,
    )
  },
)

it('treats incomplete model entries and invalid JSON as failed reads', async () => {
  const fake = upstream()
  for (const body of [
    'not JSON',
    '{}',
    '{"data":{}}',
    '{"data":[{"id":"ok"},{}]}',
    '{"data":[{"id":7}]}',
    '{"data":[{"id":" "}]}',
  ]) {
    fake.response = () => new Response(body)
    expect(await readEndpointModels(login(), fake.fetch), body).toBeNull()
  }
  fake.response = () => Response.json({ data: [], has_more: false })
  expect(await readEndpointModels(login(), fake.fetch)).toEqual([])
})

it('does not follow a redirect or read its body', async () => {
  const fake = upstream()
  const cancel = vi.fn()
  fake.response = () =>
    new Response(new ReadableStream({ cancel }), {
      status: 302,
      headers: { location: 'https://private.example.test/key=fake-key' },
    })
  expect(await readEndpointModels(login(), fake.fetch)).toBeNull()
  expect(fake.requests).toHaveLength(1)
  expect(fake.requests[0].redirect).toBe('manual')
  expect(cancel).toHaveBeenCalledOnce()
})

it('refuses private and preview addresses before a fetch', async () => {
  const fake = upstream()
  const fetch = vi.fn(fake.fetch)
  for (const endpoint of [
    'https://127.0.0.1',
    'https://port.custom-previews.example.test',
  ])
    expect(
      await readEndpointModels({ ...login(), endpoint }, fetch, [
        'custom-previews.example.test',
      ]),
    ).toBeNull()
  expect(fake.requests).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

it('cancels a response above the byte budget and hides transport errors', async () => {
  const fake = upstream()
  const cancel = vi.fn()
  const bytes = new TextEncoder().encode(
    JSON.stringify({ data: [{ id: 'x'.repeat(1_048_576) }] }),
  )
  let sent = false
  fake.response = () =>
    new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (sent) controller.close()
            else {
              controller.enqueue(bytes)
              sent = true
            }
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    )
  expect(await readEndpointModels(login(), fake.fetch)).toBeNull()
  expect(cancel).toHaveBeenCalledOnce()
  fake.responseFactories.push(() => {
    throw new Error(
      'fake-key https://proxy.example.test/edge?key=address-secret',
    )
  })
  expect(await readEndpointModels(login(), fake.fetch)).toBeNull()
})

it.each(['headers', 'body'] as const)(
  'ends a stalled %s read at the time limit',
  async (phase) => {
    vi.useFakeTimers()
    const fake = upstream()
    const started = deferred<void>()
    const cancel = vi.fn()
    fake.responseFactories.push(() => {
      started.resolve()
      return phase === 'headers'
        ? new Promise<Response>(() => undefined)
        : new Response(new ReadableStream({ cancel }))
    })
    let settled = false
    const result = readEndpointModels(login(), fake.fetch).then((value) => {
      settled = true
      return value
    })
    await started.promise
    await vi.advanceTimersByTimeAsync(9_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    expect(await result).toBeNull()
    expect(fake.requests[0].signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(phase === 'body' ? 1 : 0)
  },
)
