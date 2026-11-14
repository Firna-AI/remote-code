import { describe, expect, it } from 'vitest'
import type { AgentChatEvent } from '../../shared/generated/AgentChatEvent'
import type { TurnSpeed } from '../../shared/generated/TurnSpeed'
import { count, turn } from './event-kit'
import { renderChat } from './render-kit'

/** The end of a turn with no changed files, at the speed that its end gives. */
function end(
  turnId: string,
  state: 'finished' | 'stopped',
  durationMs: number,
  speed?: TurnSpeed,
): AgentChatEvent {
  return {
    ...turn,
    turnId,
    type: 'turn.completed',
    state,
    durationMs,
    files: [],
    omittedFileCount: 0,
    userMessageIds: [],
    ...(speed === undefined ? {} : { speed }),
  }
}

describe('the speed of a fast turn', () => {
  it('names standard speed and its known cause beside the duration and in a stop line, and nothing for a fast turn or a turn without fast mode', async () => {
    const { chat, text } = await renderChat({ conversation: 'running' })
    const standard = (cause?: string): TurnSpeed =>
      cause === undefined ? { state: 'standard' } : { state: 'standard', cause }
    chat.emit(end('turn-1', 'finished', 252_000, standard('fast_limit')))
    chat.emit(end('turn-2', 'finished', 2_000, standard('older_runner')))
    chat.emit(end('turn-3', 'finished', 3_000, standard('out_of_credits')))
    chat.emit(end('turn-4', 'finished', 4_000, standard()))
    chat.emit(end('turn-5', 'finished', 5_000, { state: 'fast' }))
    chat.emit(end('turn-6', 'finished', 6_000))
    chat.emit({
      ...turn,
      turnId: 'turn-7',
      type: 'turn.stop-requested',
      requestedById: 'jonas',
    })
    chat.emit(end('turn-7', 'stopped', 7_000, standard('fast_limit')))
    const shown = text()
    expect({
      limit: shown.includes('4m 12s Standard speed · Fast limit reached'),
      older: shown.includes(
        '2s Standard speed · Older cloud computer software',
      ),
      unknown: shown.includes('3s Standard speed 4s'),
      none: shown.includes('4s Standard speed 5s'),
      stopped: shown.includes(
        'Jonas Weber stopped the agent · Standard speed · Fast limit reached',
      ),
      notes: count(shown, 'Standard speed'),
    }).toEqual({
      limit: true,
      older: true,
      unknown: true,
      none: true,
      stopped: true,
      notes: 5,
    })
  })
})
