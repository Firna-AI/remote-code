import { beforeAll, expect, it } from 'vitest'

import {
  workspacesPath,
  type CreateWorkspaceResponse,
} from '../../src/shared/workspaces'
import { findMembership } from '../data/orgs'
import { record } from '../chat/inputs'
import { SESSION_COOKIE } from '../security/cookies'
import { seedAppAccess } from '../test-support/app-access'
import { sign } from '../security/crypto'
import { handleLifecycleRequest } from './browser'
import { FIRST_MESSAGE } from './durable-test-support'
import { realRuntimeFixture, runtimeBundle } from './real-runtime-test-support'
import { publicHistory, hasStartStep } from './runtime-events-test-support'
import { workspaceLifecycleEndpoint } from './workspace-transport'

let bundle: string
beforeAll(async () => {
  bundle = await runtimeBundle()
})

it('keeps the accepted first message and failed start readable to every member after restart', async () => {
  const fixture = await realRuntimeFixture(bundle)
  try {
    const user = {
      id: 'runtime-user',
      githubId: 11,
      githubLogin: 'octocat',
      displayName: null,
      avatarUrl: null,
    }
    const org = await findMembership(fixture.env.DB, 'runtime-org', user.id)
    if (!org) throw new Error('Missing runtime org')
    const dependencies = {
      fetch: fixture.boat.fetch,
      now: Date.now,
      randomToken: () => crypto.randomUUID(),
    }
    let notifyQueued: (id: string) => void = () => {}
    const queued = new Promise<string>((resolve) => {
      notifyQueued = resolve
    })
    const pending = handleLifecycleRequest(
      new Request(`${fixture.env.APP_ORIGIN}${workspacesPath(org.id)}`, {
        method: 'POST',
      }),
      {
        org,
        user,
        sessionId: 'runtime-browser-session',
        body: {
          repositoryId: 'runtime-repo',
          firstMessage: {
            ...FIRST_MESSAGE,
            attachmentIds: ['runtime-attachment'],
          },
        },
      },
      {
        env: fixture.env,
        dependencies,
        workspace: (id) => {
          const endpoint = workspaceLifecycleEndpoint(
            fixture.actor(id),
            fixture.env,
          )
          return {
            ...endpoint,
            queueLifecycleStart: async (job, intent) => {
              const accepted = await endpoint.queueLifecycleStart(job, intent)
              notifyQueued(id)
              return accepted
            },
          }
        },
        images: {
          env: fixture.env,
          dependencies,
          scheduler: { schedule: async () => {} },
          prepareSources: async () => {},
        },
      },
      {
        waitUntil: (work) => {
          void work.catch(() => {})
        },
        acceptFirstMessage: (first) =>
          fixture.actor(first.workspaceId).acceptFirstFixtureMessage(first),
      },
    )
    const queuedId = await queued
    await fixture.actor(queuedId).tick()
    const response = await pending
    expect(response?.status).toBe(201)
    const admitted: CreateWorkspaceResponse = await response!.json()
    const id = admitted.workspace.id
    expect(admitted.firstMessage).toMatchObject({
      text: FIRST_MESSAGE.text,
      state: 'queued',
      attachments: [
        { id: 'runtime-attachment', name: 'runtime-attachment.txt' },
      ],
    })
    const before = await fixture.openEvents(id)
    const accepted = await publicHistory(before.inbox)
    expect(accepted.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: { type: 'message.accepted', message: admitted.firstMessage },
        }),
      ]),
    )
    fixture.boat.commandExitCode = 1
    fixture.boat.deleteFailures = 1
    const actor = fixture.actor(id)
    for (let step = 0; step < 16 && (await actor.checkpoint()); step++)
      await actor.tick()
    expect(await actor.waitCreationLifecycle()).toMatchObject({
      ok: false,
      error: { code: 'workspace_start_failed' },
    })
    expect(
      await fixture.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM workspaces',
      ).first('count'),
    ).toBe(1)
    expect(
      await fixture.env.DB.prepare(
        'SELECT COUNT(*) AS count FROM workspace_tokens',
      ).first('count'),
    ).toBe(1)
    expect(await actor.readLifecycle()).toMatchObject({
      state: 'error',
      error: { code: 'workspace_start_failed' },
    })
    const reconnect = await fixture.openEvents(id, accepted.throughEventNumber)
    const failed = await publicHistory(reconnect.inbox)
    expect(
      failed.events.some((envelope) =>
        hasStartStep(envelope, 'fetch', 'failed'),
      ),
    ).toBe(true)
    expect(failed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'workspace.updated',
            workspace: expect.objectContaining({ state: 'error' }),
          }),
        }),
      ]),
    )
    const failedStep = failed.events.findIndex((envelope) =>
      hasStartStep(envelope, 'fetch', 'failed'),
    )
    const firstError = failed.events.findIndex((envelope) => {
      const event = record(envelope.event)
      return (
        event.type === 'workspace.updated' &&
        record(event.workspace).state === 'error'
      )
    })
    expect(failedStep).toBeLessThan(firstError)
    await fixture.restart()
    const restored = await fixture.openEvents(id)
    const history = await publicHistory(restored.inbox)
    expect(history.events).toEqual([...accepted.events, ...failed.events])
    expect(
      history.events.filter(
        (envelope) => record(envelope.event).type === 'message.accepted',
      ),
    ).toHaveLength(1)
    expect(restored.isClosed).toBe(false)
    await fixture.env.DB.batch([
      fixture.env.DB.prepare(
        "INSERT INTO users (id, github_id, github_login, created_at, updated_at) VALUES ('other-member', 12, 'teammate', 0, 0)",
      ),
      fixture.env.DB.prepare(
        "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ('runtime-org', 'other-member', 'member', 0)",
      ),
      fixture.env.DB.prepare(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('other-session', 'other-member', 4000000000000)",
      ),
    ])
    await seedAppAccess(fixture.env.DB, ['other-member'], 0)
    const token = await sign(
      { sessionId: 'other-session', expiresAt: 4_000_000_000_000 },
      'session',
      fixture.env.SESSION_SIGNING_KEY,
    )
    const member = await fixture.openEvents(id, 0, {
      Cookie: `${SESSION_COOKIE}=${token}`,
    })
    expect((await publicHistory(member.inbox)).events).toEqual(history.events)
    expect(member.isClosed).toBe(false)
    await expect(
      fixture.openEvents(id, 0, { Origin: 'https://untrusted.test' }),
    ).rejects.toThrow('Status: 403')
    await fixture.env.DB.prepare(
      "DELETE FROM sessions WHERE id = 'runtime-browser-session'",
    ).run()
    await expect(fixture.openEvents(id)).rejects.toThrow('Status: 401')
  } finally {
    await fixture.dispose()
  }
})
