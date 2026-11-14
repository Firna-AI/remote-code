import { expect, it, vi } from 'vitest'

import type { AgentChoice } from '../../src/shared/generated/AgentChoice'
import { parseAgentEvent } from './agent-events'
import { createRunnerLimitsFixture } from './runner-limits.test-support'
import { choice, context } from './runner-fixtures.test-support'

const completed = {
  ...context,
  type: 'turn.completed',
  state: 'finished',
  durationMs: 1,
  files: [],
  omittedFileCount: 0,
  userMessageIds: [],
}

it('stores and replays speed once after restart while dropping untrusted extra fields', async () => {
  const h = await createRunnerLimitsFixture()
  await h.receive(1, {
    ...completed,
    state: 'stopped',
    speed: { state: 'standard', cause: 'out_of_credits', raw: 'secret' },
  })
  await h.connect('stream', true)
  await h.receive(1, { ...completed, speed: { state: 'fast' } })
  const ends = (await h.history()).events.filter(
    ({ event }) => event.type === 'turn.completed',
  )
  expect(ends.map(({ event }) => event)).toEqual([
    {
      ...completed,
      state: 'stopped',
      speed: { state: 'standard', cause: 'out_of_credits' },
    },
  ])
})

async function fastTurnFixture(
  selected: AgentChoice = { ...choice, fast: true },
) {
  const h = await createRunnerLimitsFixture()
  const saveMessage = async (id: string, selected: AgentChoice) => {
    await h.store.change(
      'workspace',
      async (transaction) => {
        await transaction.saveMessage({
          id,
          sessionId: context.sessionId,
          sender: {
            id: 'sender',
            githubLogin: 'sender',
            displayName: null,
            avatarUrl: null,
          },
          text: 'Run',
          attachments: [],
          choice: selected,
          createdAt: 25,
          state: 'queued',
        })
        const turn = await transaction.turn(context.turnId)
        const session = await transaction.session(context.sessionId)
        if (!turn || !session)
          throw new Error('Missing fixture turn or session')
        await transaction.saveTurn({
          ...turn,
          started: true,
          messageIds: [...turn.messageIds, id],
        })
        await transaction.saveSession({ ...session, choice: selected })
      },
      () => undefined,
    )
  }
  await saveMessage('first-message', selected)
  return {
    ...h,
    saveMessage,
    start: (echoed: Omit<AgentChoice, 'fast'> & { fast?: boolean }) =>
      h.receive(1, {
        ...context,
        type: 'turn.started',
        choice: echoed,
        senderId: 'sender',
        startedAt: 25,
        messageIds: ['first-message'],
      }),
    ends: async () =>
      (await h.history()).events
        .filter(({ event }) => event.type === 'turn.completed')
        .map(({ event }) => event),
  }
}

it('keeps an early stop during the first file scan on a current fast runner without a speed note', async () => {
  const h = await fastTurnFixture()
  await h.start({ ...choice, fast: true })
  const end = {
    ...completed,
    state: 'stopped',
    userMessageIds: ['first-message'],
  }
  await h.receive(2, end)
  expect(await h.ends()).toEqual([end])
})

it('keeps a pending stop before turn.started without a speed note', async () => {
  const h = await fastTurnFixture()
  const end = { ...completed, state: 'stopped', durationMs: 0 }
  await h.receive(1, end)
  expect(await h.ends()).toEqual([end])
})

it('keeps a crash-recovery end from a current fast runner without a speed note after restart', async () => {
  const h = await fastTurnFixture()
  await h.start({ ...choice, fast: true })
  await h.connect('recovery-stream', true)
  const end = {
    ...completed,
    state: 'stopped',
    filesUnavailable: true,
    userMessageIds: ['first-message'],
  }
  await h.receive(1, end)
  expect(await h.ends()).toEqual([end])
})

it('keeps a standard Codex turn without a speed note when it defers a fast message', async () => {
  const selected: AgentChoice = { ...choice, agent: 'codex' }
  const h = await fastTurnFixture(selected)
  await h.start(selected)
  await h.saveMessage('deferred-message', { ...selected, fast: true })
  const end = { ...completed, userMessageIds: ['first-message'] }
  await h.receive(2, end)
  expect(await h.ends()).toEqual([end])
})

it('keeps the older runner cause after the session choice changes and the Worker restarts', async () => {
  const h = await fastTurnFixture()
  await h.start({
    agent: choice.agent,
    model: choice.model,
    effort: choice.effort,
  })
  await h.store.change(
    'workspace',
    async (transaction) => {
      const session = await transaction.session(context.sessionId)
      if (!session) throw new Error('Missing fixture session')
      await transaction.saveSession({ ...session, choice })
    },
    () => undefined,
  )
  await h.connect('stream', true)
  await h.receive(2, { ...completed, userMessageIds: ['first-message'] })
  expect(await h.ends()).toEqual([
    {
      ...completed,
      userMessageIds: ['first-message'],
      speed: { state: 'standard', cause: 'older_runner' },
    },
  ])
})

it('keeps the reported speed and reads a malformed speed as standard speed at the event boundary', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  expect(parseAgentEvent({ ...completed, speed: { state: 'fast' } })).toEqual({
    ...completed,
    speed: { state: 'fast' },
  })
  expect(
    parseAgentEvent({
      ...completed,
      speed: { state: 'standard', cause: 'future_cause' },
    }),
  ).toEqual({
    ...completed,
    speed: { state: 'standard', cause: 'future_cause' },
  })
  expect(parseAgentEvent({ ...completed, speed: { state: 'turbo' } })).toEqual({
    ...completed,
    speed: { state: 'standard' },
  })
  expect(
    parseAgentEvent({
      ...completed,
      speed: { state: 'standard', cause: 'display text' },
    }),
  ).toEqual({ ...completed, speed: { state: 'standard' } })
  expect(warn).toHaveBeenCalledTimes(2)
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'turn_speed_invalid' }),
  )
  warn.mockRestore()
})
