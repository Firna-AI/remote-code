import type { AppDependencies, AppEnv } from '../env'
import { latestSoftwareRelease } from '../lifecycle/software-release'
import { privateResponse } from '../http'
import { requestSoftwareImage } from './build'
import { deployTokenDigest } from './deploy-gate'

export const SOFTWARE_IMAGE_PATH = '/v1/deploy/software-image'

export async function handleSoftwareImage(
  request: Request,
  env: AppEnv,
  dependencies: AppDependencies,
): Promise<Response> {
  const digest = await deployTokenDigest(request, env, dependencies.now())
  return privateResponse(
    Response.json(
      await requestSoftwareImage(
        { env, dependencies },
        await latestSoftwareRelease(env, dependencies.fetch),
        digest,
      ),
    ),
  )
}
