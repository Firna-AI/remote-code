import { expect, it } from 'vitest'

import type { CreateWorkspaceRequest } from '../../src/shared/workspaces'
import { workspacesPath } from '../../src/shared/workspaces'
import { setupBackendTests } from './backend-test-hooks'
import { handleLifecycleRequest, type LifecycleBrowserOptions } from './browser'
import { FIRST_MESSAGE } from './durable-test-support'
import type { FirstWorkspaceMessage } from './workspace-runtime'
import { fakeAttachments } from '../test-support/attachments'

const fixtureForTest = setupBackendTests()

it('retries a completed create with the admitted first message after initial chat acceptance fails', async () => {
  const fixture = fixtureForTest()
  const { runtime, org, user, repositoryId } = fixture
  const original = { ...FIRST_MESSAGE, attachmentIds: ['attachment-original'] }
  const input: CreateWorkspaceRequest = {
    repositoryId,
    firstMessage: structuredClone(original),
  }
  const received: FirstWorkspaceMessage[] = []
  const options: LifecycleBrowserOptions = {
    waitUntil: (work) => {
      void work.catch(() => {})
    },
    acceptFirstMessage: async (first) => {
      received.push(structuredClone(first))
      if (received.length === 1) throw new Error('Chat acceptance unavailable')
      return {
        id: first.request.id,
        sessionId: first.sessionId,
        sender: first.sender,
        text: first.request.text,
        attachments: await fakeAttachments(first.request.attachmentIds),
        choice: first.request.choice,
        createdAt: runtime.dependencies.now(),
        state: 'queued',
      }
    },
  }
  const create = () =>
    handleLifecycleRequest(
      new Request(`${runtime.env.APP_ORIGIN}${workspacesPath(org.id)}`, {
        method: 'POST',
      }),
      { user, org, body: { ...input }, sessionId: 'signed-in-session' },
      { ...runtime, images: fixture.images },
      options,
    )
  await expect(fixture.run(create)).rejects.toThrow(
    'Chat acceptance unavailable',
  )
  const first = received[0]
  expect(first.request).toEqual(original)
  const actor = fixture.starts.get(first.workspaceId)
  if (!actor) throw new Error('Missing admitted actor')
  for (let step = 0; step < 16 && (await actor.job()); step++) {
    if ((await actor.job())?.phase === 'runner')
      await fixture.actors
        .get(first.workspaceId)
        ?.endpoint()
        .reportRunnerLifecycle({ type: 'runner.ready' })
    await actor.advance()
  }
  expect(
    await runtime.workspace(first.workspaceId).waitCreationLifecycle(),
  ).toEqual({ ok: true })
  await actor.restart()
  input.firstMessage = {
    id: original.id,
    text: 'Changed retry instructions.',
    attachmentIds: ['attachment-edited'],
    choice: {
      agent: 'claude',
      model: 'claude-sonnet-4-6',
      effort: 'medium',
      fast: false,
    },
  }
  const response = await fixture.run(create)
  expect(response?.status).toBe(201)
  expect(received).toEqual([first, first])
  expect(await response!.json()).toMatchObject({
    workspace: { id: first.workspaceId },
    sessionId: first.sessionId,
    firstMessage: {
      id: original.id,
      text: original.text,
      choice: original.choice,
      attachments: [{ id: 'attachment-original' }],
    },
  })
})
