import {
  readSoftwareRelease,
  type SoftwareRelease,
} from '../lifecycle/software-release'
import {
  IMAGE_BUILD_TIME_LIMIT_MS,
  JobTimeLimit,
} from '../lifecycle/job-time-limit'
import { transientProviderError } from '../lifecycle/provider-retry'
import { DEFAULT_PROVIDER_ACCOUNT } from '../sandbox/account-identity'
import { providerForAccount } from '../sandbox/client'
import { cleanupOldSoftwareImages, retrySoftwareImageCleanup } from './cleanup'
import {
  insertSoftwareImage,
  latestSoftwareImage,
  readSoftwareImage,
  saveSoftwareImage,
  softwareImages,
} from './data'
import { AttemptChanged } from './resources'
import {
  SOFTWARE_IMAGE_FAILED,
  SOFTWARE_IMAGE_REPLACED,
  SOFTWARE_IMAGE_TIME_LIMIT,
} from './failure'
import { advanceSoftwareImageStep } from './steps'
import type {
  SoftwareImage,
  SoftwareImageResult,
  SoftwareImageRuntime,
} from './types'
import { softwareVersion } from './version'

export async function advanceSoftwareImage(
  runtime: SoftwareImageRuntime,
  id: string,
): Promise<{ image: SoftwareImage; output: string }> {
  let output = ''
  for (;;) {
    const image = await readSoftwareImage(runtime.env.DB, id)
    if (!image) throw new AttemptChanged()
    if (image.state !== 'building') {
      await retrySoftwareImageCleanup(runtime, image)
      if (image.state === 'ready')
        await cleanupOldSoftwareImages(runtime, image.providerAccount)
      return {
        image: (await readSoftwareImage(runtime.env.DB, id)) ?? image,
        output,
      }
    }
    try {
      let error: string | null = null
      if (
        (await softwareVersion(
          readSoftwareRelease(JSON.parse(image.softwareJson)),
        )) !== image.version
      )
        error = SOFTWARE_IMAGE_REPLACED
      else if (
        runtime.dependencies.now() >=
        image.startedAt + IMAGE_BUILD_TIME_LIMIT_MS
      )
        error = SOFTWARE_IMAGE_TIME_LIMIT
      if (error) {
        await saveSoftwareImage(runtime.env.DB, image, {
          state: 'failed',
          error,
          completedAt: runtime.dependencies.now(),
        })
        continue
      }
      const step = await advanceSoftwareImageStep(
        runtime,
        providerForAccount(
          runtime.env,
          runtime.dependencies.fetch,
          image.providerAccount,
        ),
        image,
      )
      output += step.output ?? ''
      if (step.wait)
        return {
          image: (await readSoftwareImage(runtime.env.DB, id)) ?? image,
          output,
        }
    } catch (error) {
      if (error instanceof AttemptChanged) continue
      if (transientProviderError(error))
        return {
          image: (await readSoftwareImage(runtime.env.DB, id)) ?? image,
          output,
        }
      const current = await readSoftwareImage(runtime.env.DB, id)
      if (current?.state === 'building' && current.phase === image.phase)
        await saveSoftwareImage(runtime.env.DB, current, {
          state: 'failed',
          error:
            error instanceof JobTimeLimit
              ? SOFTWARE_IMAGE_TIME_LIMIT
              : SOFTWARE_IMAGE_FAILED,
          completedAt: runtime.dependencies.now(),
        })
    }
  }
}

export async function requestSoftwareImage(
  runtime: SoftwareImageRuntime,
  artifact: SoftwareRelease,
  tokenDigest: string,
): Promise<SoftwareImageResult> {
  artifact = readSoftwareRelease(artifact)
  const version = await softwareVersion(artifact)
  const account = DEFAULT_PROVIDER_ACCOUNT
  for (const old of await softwareImages(runtime.env.DB, account)) {
    if (old.state !== 'building' || old.version === version) continue
    if (
      await saveSoftwareImage(runtime.env.DB, old, {
        state: 'failed',
        error: SOFTWARE_IMAGE_REPLACED,
        completedAt: runtime.dependencies.now(),
      })
    )
      await retrySoftwareImageCleanup(runtime, {
        ...old,
        state: 'failed',
        error: SOFTWARE_IMAGE_REPLACED,
        revision: old.revision + 1,
      })
  }
  let image = await latestSoftwareImage(runtime.env.DB, account, version)
  if (
    !image ||
    (image.state === 'failed' && image.tokenDigest !== tokenDigest)
  ) {
    await insertSoftwareImage(runtime.env.DB, {
      id: runtime.dependencies.randomToken(),
      account,
      version,
      artifact,
      tokenDigest,
      now: runtime.dependencies.now(),
    })
    image = await latestSoftwareImage(runtime.env.DB, account, version)
  }
  if (!image) throw new AttemptChanged()
  const result = await advanceSoftwareImage(runtime, image.id)
  const { state, phase, error } = result.image
  return {
    state: state === 'deleting' ? 'failed' : state,
    phase,
    version,
    output: result.output,
    ...(state === 'failed'
      ? {
          error: error ?? SOFTWARE_IMAGE_FAILED,
          keptOutput: result.image.output,
        }
      : {}),
  }
}
