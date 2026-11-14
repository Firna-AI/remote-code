import { expect, it } from 'vitest'

import { setupBackendTests } from './backend-test-hooks'
import { SOFTWARE } from './backend-test-support'
import { insertBuild } from './build-admission-data'
import { assignBuildSandbox, readBuildJob } from './build-data'
import { clearSandboxCleanup, recordSandboxCleanup } from './cleanup'
import { claimCreation, recordedCreationJob } from './creation-claims'
import { prepareCreationRequest } from './create-request'
import { FIRST_MESSAGE } from './durable-test-support'
import { leasedCreationImage } from './image-leases'
import { insertSourceJob } from './image-sources/source-data'
import { nativeLifecycleStorage } from './native-storage.test-support'
import { seedPublishedImage } from './published-image-test-support'
import { buildSnapshotIntent } from './resource-intents'
import { readSavedScript } from './saved-script'
import { readStartJob, serializeStartJob } from './start-job-codec'
import { durableStartStorage, START_JOB_KEY } from './start-storage'
import { assignSandbox, insertWorkspace, readWorkspace } from './workspace-data'

const fixtureForTest = setupBackendTests()

it('keeps the image account through a creation claim, workspace, and stored start', async () => {
  const { runtime, org, user, repositoryId } = fixtureForTest()
  const db = runtime.env.DB
  await seedPublishedImage(db, {
    orgId: org.id,
    buildId: 'secondary-image-build',
    imageName: 'secondary-image',
    providerAccount: 'boat-secondary',
    repositories: [
      {
        id: repositoryId,
        orgId: org.id,
        fullName: 'example/repository',
        defaultBranch: 'main',
      },
    ],
    software: SOFTWARE,
    now: runtime.dependencies.now(),
  })
  const job = await prepareCreationRequest(
    runtime,
    org.id,
    user,
    user,
    { repositoryId, firstMessage: FIRST_MESSAGE },
    undefined,
    'boat-secondary',
    { branch: 'feature/review', startSha: 'a'.repeat(40) },
  )
  expect(job).toMatchObject({
    providerAccount: 'boat-secondary',
    baseBranch: 'feature/review',
    startSha: 'a'.repeat(40),
  })
  const key = {
    orgId: org.id,
    senderUserId: user.id,
    messageId: FIRST_MESSAGE.id,
  }
  await claimCreation(db, key, job)
  const saved = await recordedCreationJob(
    db,
    key,
    job.workspaceId,
    FIRST_MESSAGE.text,
  )
  expect(saved).toMatchObject({
    providerAccount: 'boat-secondary',
    baseBranch: 'feature/review',
    startSha: 'a'.repeat(40),
  })
  expect(
    await leasedCreationImage(db, org.id, job.workspaceId, repositoryId),
  ).toMatchObject({
    imageName: 'secondary-image',
    providerAccount: 'boat-secondary',
  })
  await insertWorkspace(db, {
    id: job.workspaceId,
    orgId: org.id,
    repositoryId,
    providerAccount: job.providerAccount,
    user,
    city: 'Lisbon',
    branch: 'account-owner/lisbon',
    baseBranch: job.baseBranch,
    sessionId: 'account-session',
    turnId: job.turnId,
    message: FIRST_MESSAGE,
    now: runtime.dependencies.now(),
  })
  await assignSandbox(
    db,
    org.id,
    job.workspaceId,
    'same-sandbox-id',
    job.providerAccount,
  )
  expect(await readWorkspace(db, org.id, job.workspaceId)).toMatchObject({
    sandboxId: 'same-sandbox-id',
    providerAccount: 'boat-secondary',
    baseBranch: 'feature/review',
  })
  const stored = serializeStartJob(job)
  expect(readStartJob(stored)).toMatchObject({
    providerAccount: 'boat-secondary',
    baseBranch: 'feature/review',
    startSha: 'a'.repeat(40),
  })
  const legacyStored = { ...stored, providerAccount: undefined }
  const legacy = readStartJob(legacyStored)
  expect(legacy).toMatchObject({ providerAccount: 'boat' })
  expect(serializeStartJob(legacy)).toMatchObject({ providerAccount: 'boat' })
  const { storage: native } = await nativeLifecycleStorage()
  const starts = durableStartStorage(
    native,
    runtime.dependencies.now,
    runtime.env,
  )
  await native.put('job', START_JOB_KEY, legacyStored)
  expect(await starts.job()).toMatchObject({ providerAccount: 'boat' })
  expect(await starts.retry(job.attempt, null)).toBe(true)
  expect(await native.get('job', START_JOB_KEY)).toMatchObject({
    providerAccount: 'boat',
  })
  await native.put('job', START_JOB_KEY, legacyStored)
  expect(await starts.stop()).toBe(true)
  expect(await native.get('job', START_JOB_KEY)).toMatchObject({
    providerAccount: 'boat',
    cancelled: true,
  })
})

it('keeps separate accounts for a build, its previous image, and its source job', async () => {
  const { runtime, org, user, repositoryId } = fixtureForTest()
  const db = runtime.env.DB
  await insertBuild(db, {
    id: 'secondary-build',
    orgId: org.id,
    providerAccount: 'boat-secondary',
    previousProviderAccount: 'boat',
    kind: 'build',
    userId: user.id,
    settingsRevision: 1,
    installScript: readSavedScript(''),
    repositories: [
      {
        id: repositoryId,
        orgId: org.id,
        fullName: 'example/repository',
        defaultBranch: 'main',
      },
    ],
    repositoryLocations: [],
    previousRepositoryLocations: [],
    software: SOFTWARE,
    previousImageName: 'last-good-image',
    now: runtime.dependencies.now(),
  })
  await assignBuildSandbox(
    db,
    'secondary-build',
    'same-sandbox-id',
    'boat-secondary',
  )
  const job = await readBuildJob(db, org.id, 'secondary-build')
  expect(job).toMatchObject({
    providerAccount: 'boat-secondary',
    previousProviderAccount: 'boat',
  })
  const intent = buildSnapshotIntent(db, job)
  await intent.persist(intent.input)
  expect(await readBuildJob(db, org.id, job.buildId)).toMatchObject({
    snapshotName: intent.input.name,
    providerAccount: 'boat-secondary',
    previousProviderAccount: 'boat',
  })
  expect(
    await insertSourceJob(
      db,
      org.id,
      job.buildId,
      'same-sandbox-id',
      'boat-secondary',
    ),
  ).toMatchObject({ providerAccount: 'boat-secondary' })
})

it('keeps a cleanup account and prevents a different account from clearing it', async () => {
  const { runtime, org } = fixtureForTest()
  const db = runtime.env.DB
  await recordSandboxCleanup(db, {
    workspaceId: 'failed-secondary-create',
    orgId: org.id,
    sandboxId: 'same-sandbox-id',
    providerAccount: 'boat-secondary',
  })
  await clearSandboxCleanup(
    db,
    'failed-secondary-create',
    'same-sandbox-id',
    'boat',
  )
  expect(
    await db
      .prepare('SELECT COUNT(*) AS count FROM lifecycle_sandbox_cleanup')
      .first('count'),
  ).toBe(1)
  await clearSandboxCleanup(
    db,
    'failed-secondary-create',
    'same-sandbox-id',
    'boat-secondary',
  )
  expect(
    await db
      .prepare('SELECT COUNT(*) AS count FROM lifecycle_sandbox_cleanup')
      .first('count'),
  ).toBe(0)
})
