import { expect, it } from 'vitest'

import { SOFTWARE } from './backend-test-support'
import { setupBackendTests } from './backend-test-hooks'
import { readBuild, readBuildJob } from './build-data'
import { advanceImageBuild, startImageBuild } from './image-builds'
import { lifecycleCommandBody } from './command-test-support'

const backendFixture = setupBackendTests()

it('runs terminal installation inside the detached software command and streams its output without starting a terminal', async () => {
  const fixture = await backendFixture()
  const { images, org, user, boat, runtime } = fixture
  const buildId = await startImageBuild(images, {
    orgId: org.id,
    userId: user.id,
    kind: 'build',
    software: SOFTWARE,
  })
  for (let step = 0; step < 6; step++) {
    const job = await readBuildJob(runtime.env.DB, org.id, buildId)
    if (job.phase === 'software' && job.processId !== null) break
    await advanceImageBuild(images, org.id, buildId)
  }
  expect(await readBuildJob(runtime.env.DB, org.id, buildId)).toMatchObject({
    phase: 'software',
    processId: 1,
  })
  expect(boat.commandRequests).toEqual([
    {
      sandboxId: 'bx_1',
      detached: true,
      command: expect.stringContaining('apt-get install -y ttyd tmux'),
    },
  ])
  const software = boat.commands[0]
  expect(lifecycleCommandBody(software)).toContain('update check --bootstrap')
  expect(lifecycleCommandBody(software)).toContain('update apply')
  expect(lifecycleCommandBody(software)).not.toContain(
    '/etc/systemd/system/conductive-terminal',
  )
  expect(lifecycleCommandBody(software)).not.toContain(
    'systemctl start conductive-terminal.service',
  )
  expect(boat.fileReads).toEqual([])
  boat.commandRunning = true
  boat.commandOutput = 'terminal installer output\n'
  await advanceImageBuild(images, org.id, buildId)
  const running = await readBuild(runtime.env.DB, org.id, buildId)
  expect(running.build.state).toBe('running')
  expect(running.log).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: 'terminal installer output\n' }),
    ]),
  )
  expect(
    await runtime.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM terminal_credentials',
    ).first<number>('count'),
  ).toBe(0)
})
