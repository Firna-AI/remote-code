import { generateKeyPairSync } from 'node:crypto'

import type { AppEnv, HttpFetch } from '../env'
import { isRecord } from '../http'
import { withSoftwareRelease } from './software-release-test-support'
import {
  handleImageSourceCredential,
  IMAGE_SOURCE_CREDENTIAL_PATH,
} from './image-sources/credential'

let privateKey: string | undefined

export function imageAppKey(): string {
  return (privateKey ??= generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString())
}

export function backendImageFetch(
  env: AppEnv,
  provider: HttpFetch,
  github: HttpFetch,
): HttpFetch {
  let sequence = 0
  return withSoftwareRelease(async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'api.github.com') {
      if (
        request.method === 'POST' &&
        /^\/app\/installations\/\d+\/access_tokens$/.test(url.pathname)
      )
        return Response.json(
          { token: `ghs_lifecycle_image_${++sequence}` },
          { status: 201 },
        )
      if (request.method === 'DELETE' && url.pathname === '/installation/token')
        return new Response(null, { status: 204 })
    }
    if (url.hostname !== 'boat.dev') return github(request)
    if (request.method === 'POST' && url.pathname.endsWith('/commands')) {
      const body: unknown = await request.clone().json()
      if (isRecord(body) && typeof body.command === 'string') {
        const grant = body.command.match(
          /Authorization: Bearer ([A-Za-z0-9_-]+)/,
        )?.[1]
        if (grant) {
          const response = await handleImageSourceCredential(
            new Request(
              `${env.MACHINE_ORIGIN}${IMAGE_SOURCE_CREDENTIAL_PATH}`,
              { method: 'POST', headers: { Authorization: `Bearer ${grant}` } },
            ),
            env,
          )
          await response.body?.cancel()
        }
      }
    }
    return provider(request)
  })
}
