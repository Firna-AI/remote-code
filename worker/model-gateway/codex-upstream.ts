import type { RunnerLogin } from '../../src/shared/generated/RunnerLogin'
import type { HttpFetch } from '../env'
import { codexRouting } from './codex-routing'
import type { CodexGatewayAuth } from './codex-auth'
import { GatewayRequestError } from './errors'
import { upstreamHeaders } from './headers'
import { codexTokenPaths } from './paths'
import type { GatewayRequestLifetime } from './request-lifetime'

export async function codexTokenUpstream(
  request: Request,
  suffix: string,
  login: RunnerLogin,
  lifetime: GatewayRequestLifetime,
  fetch: HttpFetch,
  auth: CodexGatewayAuth,
): Promise<Response> {
  const headers = upstreamHeaders(request.headers, login)
  const send = (
    url: string,
    method: string,
    body: ReadableStream<Uint8Array> | null = null,
  ) => {
    const init = {
      method,
      headers,
      body,
      duplex: 'half',
      redirect: 'manual' as const,
      signal: lifetime.signal,
    }
    return lifetime.wait(
      (async () => {
        headers.set('authorization', `Bearer ${auth.current.accessToken}`)
        headers.set('chatgpt-account-id', auth.current.accountId)
        let response = lifetime.received(await fetch(new Request(url, init)))
        if (response.status === 401) {
          await response.body?.cancel()
          await lifetime.wait(auth.renew(auth.current.accessToken))
          if (method === 'POST') {
            await lifetime.wait(lifetime.upload.finish())
            throw new GatewayRequestError(
              'model_upstream_unavailable',
              'The model request must be sent again.',
            )
          }
          headers.set('authorization', `Bearer ${auth.current.accessToken}`)
          headers.set('chatgpt-account-id', auth.current.accountId)
          response = lifetime.received(await fetch(new Request(url, init)))
          if (response.status === 401) {
            await response.body?.cancel()
            return lifetime.wait(auth.reject())
          }
        }
        return response
      })(),
    )
  }
  const search = new URL(request.url).search
  if (
    suffix === codexTokenPaths.accounts ||
    suffix === codexTokenPaths.responses
  ) {
    const response = await send(
      `https://chatgpt.com${codexTokenPaths.accounts}${suffix === codexTokenPaths.accounts ? search : ''}`,
      'GET',
    )
    if (!response.ok) return response
    const value: unknown = await lifetime.wait(response.json())
    const routing = codexRouting(value, headers.get('chatgpt-account-id'))
    if (suffix === codexTokenPaths.accounts)
      return Response.json(routing.body, {
        status: response.status,
        headers: response.headers,
      })
    if (routing.override)
      headers.set('x-openai-account-routing-override', routing.override)
    return send(
      `${routing.origin}${suffix}${search}`,
      'POST',
      lifetime.upload.body,
    )
  }
  return send(`https://chatgpt.com${suffix}${search}`, 'GET')
}
