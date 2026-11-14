import type { AppEnv, HttpFetch } from '../env'
import { HttpError, isRecord } from '../http'
import { readImageSoftware, type ImageSoftwareArtifact } from './image-software'

export interface SoftwareRelease extends ImageSoftwareArtifact {
  version: string
  server: string
}

const RELEASE_SERVER = 'https://runner.conductive.build'
const target = 'x86_64-unknown-linux-musl'

export function readSoftwareRelease(value: unknown): SoftwareRelease {
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    !/^0\.0\.(0|[1-9][0-9]*)$/.test(value.version) ||
    typeof value.server !== 'string'
  )
    throw unavailable()
  const artifact = readImageSoftware(value)
  const server = readImageSoftware({
    url: value.server,
    sha256: artifact.sha256,
  }).url.replace(/\/$/, '')
  return { ...artifact, version: value.version, server }
}

export async function latestSoftwareRelease(
  env: Pick<AppEnv, 'CONDUCTIVE_RELEASE_SERVER'>,
  fetch: HttpFetch,
): Promise<SoftwareRelease> {
  try {
    const server = env.CONDUCTIVE_RELEASE_SERVER ?? RELEASE_SERVER
    const base = readImageSoftware({
      url: server,
      sha256: '0'.repeat(64),
    }).url.replace(/\/$/, '')
    const response = await fetch(
      new Request(`${base}/releases/latest/conductive/${target}`, {
        redirect: 'manual',
      }),
    )
    if (!response.ok) throw unavailable()
    const value: unknown = await response.json()
    if (
      !isRecord(value) ||
      value.binary !== 'conductive' ||
      value.target !== target ||
      typeof value.asset_name !== 'string' ||
      !value.asset_name.endsWith('.tar.gz')
    )
      throw unavailable()
    return readSoftwareRelease({
      url: value.download_url,
      sha256: value.sha256,
      version: value.version,
      server: base,
    })
  } catch {
    throw unavailable()
  }
}

function unavailable(): HttpError {
  return new HttpError(
    503,
    'runner_software_unavailable',
    'The cloud computer software release is not available. Try again later.',
  )
}
