import { installImageSoftware } from '../lifecycle/image-software'
import { readSoftwareRelease } from '../lifecycle/software-release'
import {
  clearImageCommands,
  lifecycleCommand,
} from '../lifecycle/command-intents'
import { providerState } from '../lifecycle/provider-state'
import {
  IMAGE_BUILD_TIME_LIMIT_MS,
  JobTimeLimit,
} from '../lifecycle/job-time-limit'
import type { SandboxProvider } from '../sandbox/provider'
import { readSoftwareImage, saveSoftwareImage } from './data'
import { keptOutput } from './output'
import { SOFTWARE_IMAGE_FAILED } from './failure'
import {
  allocateSoftwareImage,
  AttemptChanged,
  snapshotSoftwareImage,
} from './resources'
import type { SoftwareImage, SoftwareImageRuntime } from './types'

export async function advanceSoftwareImageStep(
  runtime: SoftwareImageRuntime,
  provider: SandboxProvider,
  image: SoftwareImage,
): Promise<{ wait?: boolean; output?: string }> {
  const db = runtime.env.DB
  if (image.phase === 'create') {
    await saveSoftwareImage(db, image, { phase: 'allocating' })
    return {}
  }
  if (image.phase === 'allocating') {
    const sandboxId = await allocateSoftwareImage(db, provider, image)
    const current = await readSoftwareImage(db, image.id)
    if (current?.state === 'building' && current.phase === 'allocating')
      await saveSoftwareImage(db, current, { sandboxId, phase: 'software' })
    return {}
  }
  if (!image.sandboxId) throw new Error('Missing software image sandbox')
  const state = providerState((await provider.get(image.sandboxId)).state)
  if (state === 'error' || state === 'stopped')
    throw new Error('Software image sandbox did not start')
  if (state !== 'ready') return { wait: true }
  await provider.setAutoStop(image.sandboxId, 1800)
  if (runtime.dependencies.now() >= image.startedAt + IMAGE_BUILD_TIME_LIMIT_MS)
    throw new JobTimeLimit('build')
  if (image.phase === 'software') {
    if (image.processId === null) {
      const started = await provider.startCommand(
        image.sandboxId,
        lifecycleCommand(
          { kind: 'software-image', id: image.id },
          'software',
          installImageSoftware(
            readSoftwareRelease(JSON.parse(image.softwareJson)),
          ),
        ),
      )
      await saveSoftwareImage(db, image, { processId: started.processId })
      return {}
    }
    const status = await provider.getCommandStatus(
      image.sandboxId,
      image.processId,
      image,
    )
    const output = status.stdout + status.stderr
    const waiting = status.more || status.running
    const failed =
      !waiting &&
      (status.state !== 'exited' || status.exitCode !== 0 || status.timedOut)
    if (
      !(await saveSoftwareImage(db, image, {
        stdoutOffset: status.stdoutNextOffset,
        stderrOffset: status.stderrNextOffset,
        output: keptOutput(image.output + output),
        phase: waiting || failed ? 'software' : 'journal',
        ...(failed
          ? {
              state: 'failed',
              error: SOFTWARE_IMAGE_FAILED,
              completedAt: runtime.dependencies.now(),
            }
          : {}),
      }))
    )
      throw new AttemptChanged()
    return { wait: waiting, output }
  }
  if (image.phase === 'journal') {
    await clearImageCommands(provider, image.sandboxId)
    await saveSoftwareImage(db, image, { phase: 'snapshot' })
    return {}
  }
  if (image.phase === 'snapshot') {
    const snapshot = await snapshotSoftwareImage(db, provider, image)
    if (snapshot.status === 'failed')
      throw new Error('Software image save failed')
    const current = await readSoftwareImage(db, image.id)
    if (
      snapshot.status === 'ready' &&
      current?.state === 'building' &&
      current.phase === 'snapshot'
    )
      await saveSoftwareImage(db, current, { phase: 'publish' })
    return { wait: snapshot.status !== 'ready' }
  }
  if (image.phase === 'publish') {
    await saveSoftwareImage(db, image, {
      state: 'ready',
      phase: 'cleanup',
      completedAt: runtime.dependencies.now(),
    })
    return {}
  }
  throw new Error('Invalid software image phase')
}
