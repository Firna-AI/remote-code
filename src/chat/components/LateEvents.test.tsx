import { describe, expect, it } from 'vitest'
import type { AgentChatEvent } from '../../shared/generated/AgentChatEvent'
import type { ChangedFile } from '../../shared/generated/ChangedFile'
import { FAKE_TIME } from '../../test-support/fixtures/core'
import { workspaceFixtures } from '../../test-support/fixtures/workspaces'
import {
  count,
  failed,
  recordNaming,
  refused,
  turn,
  unreadEnd,
  update,
} from './event-kit'
import { renderChat } from './render-kit'

const { message } = workspaceFixtures()
const second = { ...turn, turnId: 'turn-2' }
const cart: ChangedFile = {
  path: 'src/Cart.tsx',
  change: 'added',
  added: 2,
  removed: 0,
}

/** A message that waits for the next turn. */
const later = {
  ...message,
  id: 'ask-2',
  text: 'Then add tests for the form.',
  state: 'queued' as const,
}

/** The second turn starts with the message that waited for it. */
const secondStarts: AgentChatEvent = {
  ...second,
  type: 'turn.started',
  senderId: message.sender.id,
  choice: message.choice,
  startedAt: FAKE_TIME,
  messageIds: [later.id],
}

/** A stopped end of a turn, with the changed files that the runner kept. */
function stoppedEnd(
  turnId: string,
  files: readonly ChangedFile[],
  omittedFileCount = 0,
): AgentChatEvent {
  return {
    ...turn,
    turnId,
    type: 'turn.completed',
    state: 'stopped',
    durationMs: 1_000,
    files,
    omittedFileCount,
    userMessageIds: [],
  }
}

/** Whether every part shows in the text, each after the one before it. */
function inOrder(text: string, parts: readonly string[]): boolean {
  const places = parts.map((part) => text.indexOf(part))
  return places.every((place, index) => place > (places[index - 1] ?? -1))
}

describe('accepted events of a turn that has ended', () => {
  it('keeps late text, a late tool, and a late end inside the ended turn', async () => {
    const { chat, text } = await renderChat({ conversation: 'running' })
    chat.emit({ type: 'message.accepted', message: later })
    chat.emit({ ...turn, type: 'turn.stop-requested', requestedById: 'jonas' })
    chat.emit(stoppedEnd('turn-1', []))
    chat.emit({
      ...turn,
      type: 'assistant.delta',
      messageId: 'late',
      text: 'Late words of turn one.',
    })
    chat.emit(update('late', 'late-tool', 0, 'running'))
    expect(text()).not.toMatch(/Working|Thinking|\bStop\b/)
    expect(text()).toContain('Ran late-tool Stopped')

    chat.emit(stoppedEnd('turn-1', [cart], 3))
    const shown = text()
    expect(shown).not.toMatch(/Working|Thinking|\bStop\b/)
    expect(shown).toContain('Cart.tsx +2 3 more files')
    expect(shown).not.toContain('not listed')
    expect(
      inOrder(shown, [
        'Late words of turn one.',
        'Ran late-tool',
        'Cart.tsx',
        'Jonas Weber stopped the agent',
        later.text,
      ]),
    ).toBe(true)
  })

  it('keeps a newer turn running, and its Try again, after late events of an older turn', async () => {
    const { chat, text } = await renderChat({ conversation: 'running' })
    chat.emit(stoppedEnd('turn-1', []))
    chat.emit({ type: 'message.accepted', message: later })
    chat.emit(secondStarts)
    chat.emit({ ...update('b', 'build', 0, 'running'), turnId: 'turn-2' })
    chat.emit({ ...turn, type: 'turn.thinking' })
    chat.emit(update('late', 'late-tool', 0, 'running'))
    chat.emit(stoppedEnd('turn-1', [cart]))
    expect(text()).toContain('Running build Working 2m 41s')
    expect(text()).toContain('Ran late-tool Stopped')
    expect(inOrder(text(), ['Cart.tsx', later.text, 'Running build'])).toBe(
      true,
    )

    chat.emit(failed('turn-2', 'The second turn failed.', later.id))
    chat.emit(recordNaming(chat.controller, later.id))
    chat.emit({
      ...turn,
      type: 'assistant.delta',
      messageId: 'late',
      text: 'Late words of turn one.',
    })
    expect(text()).toContain('The second turn failed. Try again')
    expect(inOrder(text(), ['Late words of turn one.', later.text])).toBe(true)
  })

  it('marks the files of a late end that the cloud computer could not read', async () => {
    const { chat, text } = await renderChat({ conversation: 'running' })
    chat.emit({ type: 'message.accepted', message: later })
    // The second turn starts, so the first one has ended.
    chat.emit(secondStarts)
    chat.emit(unreadEnd('turn-1', 'finished'))
    expect(inOrder(text(), ['1s Changed files unavailable', later.text])).toBe(
      true,
    )

    // The second turn ends without its files. A late end of the same turn
    // then says that the cloud computer could not read them.
    chat.emit(stoppedEnd('turn-2', []))
    expect(text()).not.toContain('stopped · ')
    chat.emit(unreadEnd('turn-2', 'stopped'))
    expect(text()).toContain('The agent stopped · Changed files unavailable')
    expect(text()).not.toMatch(/Working|Try again/)
  })

  it('shows one Try again, on the newer failure, when a late failure of an older turn names the same message', async () => {
    const { chat, text } = await renderChat({ conversation: 'running' })
    chat.emit({ type: 'message.accepted', message: later })
    chat.emit({ ...turn, type: 'message.sent', messageId: later.id })
    chat.emit({
      ...turn,
      type: 'turn.completed',
      state: 'finished',
      durationMs: 1_000,
      files: [],
      omittedFileCount: 0,
      userMessageIds: [message.id],
    })
    // A new turn continues the message that the first turn left unanswered.
    chat.emit(secondStarts)
    chat.emit(failed('turn-2', 'The second turn failed.', later.id))
    chat.emit(recordNaming(chat.controller, later.id))
    chat.emit(failed('turn-1', 'The first turn failed.', later.id))
    const shown = text()
    expect(shown).toContain('The first turn failed.')
    expect(shown).toContain('The second turn failed. Try again')
    expect(count(shown, 'Try again')).toBe(1)
  })
})

describe('refusal markers of other turns', () => {
  it('keep Try again on the newer failure', async () => {
    const { chat, text } = await renderChat({ conversation: 'running' })
    chat.emit({ type: 'message.accepted', message: later })
    chat.emit(failed('turn-1', 'The first turn failed.', message.id))
    chat.emit(secondStarts)
    chat.emit(failed('turn-2', 'The second turn failed.', later.id))
    chat.emit(recordNaming(chat.controller, later.id))
    expect(text()).toContain('The second turn failed. Try again')

    chat.emit(refused(50, 'turn.failed', 'too_large'))
    chat.emit(refused(51, 'turn.completed', 'invalid', { turnId: 'never' }))
    chat.emit(
      refused(52, 'tool.updated', 'turn_not_active', { turnId: 'never' }),
    )
    const shown = text()
    expect(shown).toContain('The second turn failed. Try again')
    expect(count(shown, 'Try again')).toBe(1)
    expect(shown).toContain(
      'The error of a turn was lost because it was too large',
    )
    expect(shown).toContain(
      'A tool update was lost because its turn never started',
    )
  })
})
