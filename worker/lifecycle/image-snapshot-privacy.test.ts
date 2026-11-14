import { expect, it } from 'vitest'

import { boatRoute } from '../sandbox/routes'
import { setupBackendTests } from './backend-test-hooks'
import { SOFTWARE } from './backend-test-support'
import { readBuildJob } from './build-data'
import { shellQuote } from './commands'
import { advanceImageBuild, startImageBuild } from './image-builds'
import { localSavedScriptFixture } from './saved-script-test-support'

const backendFixture = setupBackendTests()

it('removes sensitive command output before requesting an image snapshot', async () => {
  const fixture = await backendFixture()
  const { images, org, user, boat, runtime } = fixture
  const local = await localSavedScriptFixture(fixture.repositoryId, 'build')
  const sensitive = 'sensitive-fixture-output'
  try {
    await runtime.env.DB.prepare(
      'UPDATE settings SET install_script = ? WHERE org_id = ?',
    )
      .bind(`printf '%s\\n' ${shellQuote(sensitive)}`, org.id)
      .run()
    boat.beforeCommand = async (command, detached) => {
      const install = local.contains(command, 'install')
      if (detached && !install) return
      if (install) await local.writeBuildEnvironment(boat.starts.at(-1)?.env)
      await local.run(command)
    }
    const id = await startImageBuild(images, {
      orgId: org.id,
      userId: user.id,
      kind: 'build',
      software: SOFTWARE,
    })
    let job = await readBuildJob(runtime.env.DB, org.id, id)
    for (let step = 0; step < 8 && job.phase !== 'snapshot'; step++) {
      await advanceImageBuild(images, org.id, id)
      job = await readBuildJob(runtime.env.DB, org.id, id)
    }
    expect(job.phase).toBe('snapshot')
    expect(await local.buildJournal(id)).toEqual({
      stdout: 'sensitive-fixture-output\n',
    })
    let journalAtSnapshot:
      Awaited<ReturnType<typeof local.buildJournal>> | undefined
    const save = boatRoute({ operation: 'saveSnapshot' })
    images.dependencies = {
      ...images.dependencies,
      fetch: async (request) => {
        if (
          request.method === save.method &&
          new URL(request.url).pathname.endsWith(save.path)
        )
          journalAtSnapshot = await local.buildJournal(id)
        return boat.fetch(request)
      },
    }
    await advanceImageBuild(images, org.id, id)
    expect(journalAtSnapshot).toBeNull()
  } finally {
    await local.dispose()
  }
})
