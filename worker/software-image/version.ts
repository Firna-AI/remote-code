import { installImageSoftware } from '../lifecycle/image-software'
import type { SoftwareRelease } from '../lifecycle/software-release'
import { sha256Hex } from './digest'

export async function softwareVersion(
  artifact: SoftwareRelease,
): Promise<string> {
  return sha256Hex(
    [artifact.version, installImageSoftware(artifact)].join('\n'),
  )
}
