import type { ToolCall } from '../../shared/generated/ToolCall'
import type { UserMessage } from '../../shared/generated/UserMessage'
import type { ChatEvent } from '../../shared/chat-events'
import type { Clock } from '../ui/clock'
import type { DevScript } from './dev-answers'
import type { DevStream } from './dev-stream'

interface Turn {
  turnId: string
  sessionId: string
  answers: string[]
  timers: number[]
  tool: ToolCall | null
  startedAt: number
}

/** When the plan of a turn starts, and the time between two of its parts. */
const planAt = 1_600
const planGap = 300

/** When the answer of a turn starts, and the time between two of its parts. */
const answerAt = 7_200
const partGap = 400

const tool = (
  id: string,
  kind: ToolCall['kind'],
  target: string,
): ToolCall => ({
  id,
  kind,
  target,
  detail: null,
  omittedDetailBytes: 0,
  state: 'running',
})

/**
 * A scripted agent for the development page. Each turn thinks, writes its
 * plan, runs three tool calls, answers every message that it read, and
 * ends. Each part of `plan` and of `answer` comes as its own update, and
 * the whole answer with the last part. A message during a turn steers it,
 * and Stop ends it as stopped.
 */
export class DevAgent {
  private readonly stream: DevStream
  private readonly clock: Clock
  private readonly plan: readonly string[]
  private readonly answer: readonly string[]
  private readonly turns = new Map<string, Turn>()
  private count = 0
  /**
   * Called when a turn of a session starts, with its start time, and after
   * its end, with null, so the session record names its active turn.
   */
  onTurn: (
    sessionId: string,
    turnId: string | null,
    at: number | null,
  ) => void = () => {}

  constructor(stream: DevStream, clock: Clock, script: DevScript) {
    this.stream = stream
    this.clock = clock
    this.plan = script.plan
    this.answer = script.answer
  }

  running(sessionId: string): string | null {
    return this.turns.get(sessionId)?.turnId ?? null
  }

  /** The sessions whose scripted turn runs. */
  runningSessions(): string[] {
    return [...this.turns.keys()]
  }

  start(sessionId: string, messages: readonly UserMessage[]): string {
    this.count += 1
    const turnId = `dev-turn-${this.count}`
    const turn: Turn = {
      turnId,
      sessionId,
      answers: messages.map((message) => message.id),
      timers: [],
      tool: null,
      startedAt: this.clock.now(),
    }
    this.turns.set(sessionId, turn)
    this.onTurn(sessionId, turnId, turn.startedAt)
    const context = { sessionId, turnId }
    const answer = `dev-answer-${this.count}`
    const parts = this.answer
    const done = answerAt + (parts.length - 1) * partGap
    const steps: [number, () => ChatEvent][] = [
      [
        0,
        () => ({
          ...context,
          type: 'turn.started',
          senderId: messages[0]?.sender.id ?? 'you',
          choice: messages[0].choice,
          startedAt: turn.startedAt,
          messageIds: turn.answers,
        }),
      ],
      [600, () => ({ ...context, type: 'turn.thinking' })],
      ...this.plan.map((text, index): [number, () => ChatEvent] => [
        planAt + index * planGap,
        () => ({
          ...context,
          type: 'assistant.delta',
          messageId: `${answer}-plan`,
          text,
        }),
      ]),
      ...this.toolSteps(
        turn,
        2_400,
        tool('read', 'read', 'src/app/checkout/AddressForm.tsx'),
        null,
      ),
      ...this.toolSteps(
        turn,
        3_600,
        tool('search', 'search', 'usePlaces'),
        '2 results',
      ),
      ...this.toolSteps(
        turn,
        4_800,
        tool('edit', 'edit', 'src/app/checkout/AddressForm.tsx'),
        '+12 −3',
      ),
      [6_400, () => ({ ...context, type: 'turn.thinking' })],
      ...parts.slice(0, -1).map((text, index): [number, () => ChatEvent] => [
        answerAt + index * partGap,
        () => ({
          ...context,
          type: 'assistant.delta',
          messageId: answer,
          text,
        }),
      ]),
      [
        done,
        () => ({
          ...context,
          type: 'assistant.completed',
          messageId: answer,
          text: parts.join(''),
          userMessageIds: turn.answers,
        }),
      ],
      [
        done + 300,
        () => ({
          ...context,
          type: 'turn.completed',
          state: 'finished',
          durationMs: this.clock.now() - turn.startedAt,
          files: [
            {
              path: 'src/app/checkout/AddressForm.tsx',
              change: 'modified',
              added: 12,
              removed: 3,
            },
          ],
          omittedFileCount: 0,
          userMessageIds: turn.answers,
        }),
      ],
    ]
    for (const [delay, event] of steps) {
      turn.timers.push(
        window.setTimeout(() => {
          const next = event()
          this.stream.emit(next)
          // The record names no active turn after the end, as the Worker does.
          if (next.type === 'turn.completed') this.onTurn(sessionId, null, null)
        }, delay),
      )
    }
    turn.timers.push(
      window.setTimeout(() => this.turns.delete(sessionId), done + 400),
    )
    return turnId
  }

  private toolSteps(
    turn: Turn,
    at: number,
    call: ToolCall,
    detail: string | null,
  ): [number, () => ChatEvent][] {
    const context = { sessionId: turn.sessionId, turnId: turn.turnId }
    return [
      [
        at,
        () => {
          turn.tool = call
          return { ...context, type: 'tool.updated', tool: call }
        },
      ],
      [
        at + 900,
        () => {
          turn.tool = null
          return {
            ...context,
            type: 'tool.updated',
            tool: { ...call, detail, state: 'done' },
          }
        },
      ],
    ]
  }

  /** A message during a turn goes to the agent at once, and its answer covers it. */
  steer(message: UserMessage): string | null {
    const turn = this.turns.get(message.sessionId)
    if (!turn) return null
    turn.answers.push(message.id)
    this.stream.emit({ type: 'message.accepted', message })
    this.stream.emit({
      type: 'message.sent',
      sessionId: turn.sessionId,
      messageId: message.id,
      turnId: turn.turnId,
    })
    return turn.turnId
  }

  /** Stop: the running call shows as stopped, and the turn ends as stopped. */
  interrupt(sessionId: string): void {
    const turn = this.turns.get(sessionId)
    if (!turn) return
    for (const timer of turn.timers) window.clearTimeout(timer)
    this.turns.delete(sessionId)
    const context = { sessionId, turnId: turn.turnId }
    if (turn.tool) {
      this.stream.emit({
        ...context,
        type: 'tool.updated',
        tool: { ...turn.tool, state: 'stopped' },
      })
    }
    this.stream.emit({
      ...context,
      type: 'turn.completed',
      state: 'stopped',
      durationMs: this.clock.now() - turn.startedAt,
      files: [],
      omittedFileCount: 0,
      userMessageIds: turn.answers,
    })
    this.onTurn(sessionId, null, null)
  }

  dispose(): void {
    for (const turn of this.turns.values()) {
      for (const timer of turn.timers) window.clearTimeout(timer)
    }
    this.turns.clear()
  }
}
