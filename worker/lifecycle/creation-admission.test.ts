import { expect, it } from 'vitest'
import type { UserMessage } from '../../src/shared/generated/UserMessage'
import {
  workspacesPath,
  type CreateWorkspaceResponse,
} from '../../src/shared/workspaces'
import { setupBackendTests } from './backend-test-hooks'
import { handleLifecycleRequest, type LifecycleBrowserOptions } from './browser'
import { FIRST_MESSAGE } from './durable-test-support'

const fixtureForTest = setupBackendTests()

it('answers with the stored queued first message before starting a sandbox and preserves that admission across retries', async () => {
  const fixture = fixtureForTest()
  const { runtime, org, user, repositoryId, boat } = fixture
  const input = {
    repositoryId,
    firstMessage: { ...FIRST_MESSAGE, attachmentIds: ['attachment-one'] },
  }
  const messages = new Map<string, UserMessage>()
  const options: LifecycleBrowserOptions = {
    waitUntil: (work) => {
      void work.catch(() => {})
    },
    acceptFirstMessage: async (first) => {
      const stored = messages.get(first.request.id)
      if (stored) return stored
      const message: UserMessage = {
        id: first.request.id,
        sessionId: first.sessionId,
        sender: first.sender,
        text: first.request.text,
        choice: first.request.choice,
        createdAt: runtime.dependencies.now(),
        attachments: [
          {
            id: 'attachment-one',
            name: 'notes.txt',
            path: null,
            kind: 'file',
            mediaType: 'text/plain',
            sizeBytes: 7,
          },
        ],
        state: 'queued',
      }
      messages.set(message.id, message)
      return message
    },
  }
  const create = () =>
    handleLifecycleRequest(
      new Request(`${runtime.env.APP_ORIGIN}${workspacesPath(org.id)}`, {
        method: 'POST',
      }),
      { user, org, body: input, sessionId: 'signed-in-session' },
      { ...runtime, images: fixture.images },
      options,
    )
  const response = await fixture.run(create)
  expect(response?.status).toBe(201)
  const admitted: CreateWorkspaceResponse = await response!.json()
  expect(admitted).toMatchObject({
    workspace: { state: 'starting' },
    firstMessage: {
      text: FIRST_MESSAGE.text,
      state: 'queued',
      attachments: [{ id: 'attachment-one' }],
    },
  })
  expect(boat.starts).toEqual([])
  const id = admitted.workspace.id
  const actor = fixture.starts.get(id)
  if (!actor) throw new Error('Missing admitted actor')
  expect(await actor.job()).toMatchObject({ phase: 'machine' })
  await actor.restart()
  input.firstMessage.text =
    'A duplicate cannot replace the stored first message.'
  const repeated = await fixture.run(create)
  expect(await repeated!.json()).toEqual(admitted)
  expect(messages.size).toBe(1)
  expect(
    await runtime.env.DB.prepare(
      'SELECT message_text AS text, attachment_ids_json AS attachments FROM workspace_creation_plans WHERE workspace_id = ?',
    )
      .bind(id)
      .first(),
  ).toEqual({ text: FIRST_MESSAGE.text, attachments: '["attachment-one"]' })
  boat.commandExitCode = 1
  for (let step = 0; step < 16 && (await actor.job()); step++)
    await actor.advance()
  expect(await runtime.workspace(id).waitCreationLifecycle()).toMatchObject({
    ok: false,
    error: { code: 'workspace_start_failed' },
  })
  expect(await runtime.workspace(id).waitCreationAdmission()).toMatchObject({
    ok: true,
    created: {
      first: {
        request: {
          ...FIRST_MESSAGE,
          attachmentIds: ['attachment-one'],
        },
      },
    },
  })
  expect(
    await runtime.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM workspaces',
    ).first('count'),
  ).toBe(1)
  expect(
    await runtime.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM workspace_tokens',
    ).first('count'),
  ).toBe(1)
  const events = fixture.actors
    .get(id)
    ?.events.map((envelope) => envelope.event)
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'workspace.updated',
        workspace: expect.objectContaining({ state: 'error' }),
      }),
      expect.objectContaining({
        type: 'start.updated',
        start: expect.objectContaining({
          steps: expect.arrayContaining([
            expect.objectContaining({ id: 'fetch', state: 'failed' }),
          ]),
        }),
      }),
    ]),
  )
})
