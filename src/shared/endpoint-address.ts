import type { Agent } from './generated/Agent'
import { isPublicEndpointHost } from './endpoint-host'

export const ENDPOINT_ADDRESS_ERROR = {
  code: 'invalid_endpoint',
  message:
    'Use a public https:// address with a host name, without a user name or a password.',
} as const

export interface EndpointAddress {
  endpoint: string
  origin: string
  host: string
  upstream: string
  secretForms: readonly string[]
}

interface EndpointAddressOptions {
  route?: string
  search?: string
  refusedDomains?: readonly string[]
}

/** Validate and join at the same boundary, including a saved base's query. */
export function readEndpointAddress(
  value: unknown,
  agent: Agent,
  { route, search = '', refusedDomains = [] }: EndpointAddressOptions = {},
): EndpointAddress | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !isPublicEndpointHost(url.hostname, refusedDomains)
    )
      return null
    url.hash = ''
    let path = url.pathname.replace(/\/+$/, '')
    if (agent === 'claude') path = path.replace(/\/v1$/, '')
    url.pathname = path
    const endpoint = `${url.origin}${path}${url.search}`
    const relative = `${path}${url.search}`
    const hasSavedSuffix =
      url.search !== '' ||
      (path !== '' && (agent === 'claude' || path !== '/v1'))
    const parts = [
      ...path.split('/').map(decodePathSegment),
      ...url.searchParams.values(),
    ].filter((part) => part.length >= 12)
    if (route !== undefined) {
      const routes =
        agent === 'claude'
          ? ['/v1/messages', '/v1/messages/count_tokens', '/v1/models']
          : ['/responses', '/models']
      if (!routes.includes(route)) return null
      url.pathname = `${path}${route}`
      if (search)
        url.search += `${url.search ? '&' : '?'}${search.replace(/^\?/, '')}`
    }
    const secretForms = [
      value,
      endpoint,
      url.href,
      url.origin,
      url.host,
      url.hostname,
      ...(hasSavedSuffix ? [relative, `${url.pathname}${url.search}`] : []),
      ...parts,
    ].filter(Boolean)
    return {
      endpoint,
      origin: url.origin,
      host: url.host,
      upstream: url.href,
      secretForms: [
        ...new Set(
          secretForms.flatMap((part) => [
            part,
            encodeAddressPart(part),
            JSON.stringify(part).slice(1, -1),
            JSON.stringify(part).slice(1, -1).replaceAll('/', '\\/'),
          ]),
        ),
      ],
    }
  } catch {
    return null
  }
}

function decodePathSegment(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function encodeAddressPart(part: string): string {
  try {
    return encodeURIComponent(part)
  } catch {
    return part
  }
}
