import type { HttpFetch } from '../env'
import type { SoftwareRelease } from './software-release'

export const SOFTWARE_RELEASE: SoftwareRelease = {
  url: 'https://software.conductive.test/conductive.tar.gz',
  sha256: 'a'.repeat(64),
  version: '0.0.42',
  server: 'https://runner.conductive.build',
}

export function withSoftwareRelease(fetch: HttpFetch): HttpFetch {
  return async (request) => {
    if (
      request.method === 'GET' &&
      request.url ===
        `${SOFTWARE_RELEASE.server}/releases/latest/conductive/x86_64-unknown-linux-musl`
    )
      return Response.json({
        binary: 'conductive',
        target: 'x86_64-unknown-linux-musl',
        asset_name: 'conductive.tar.gz',
        version: SOFTWARE_RELEASE.version,
        download_url: SOFTWARE_RELEASE.url,
        sha256: SOFTWARE_RELEASE.sha256,
      })
    return fetch(request)
  }
}
