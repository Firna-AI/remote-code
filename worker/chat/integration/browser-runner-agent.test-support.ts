import type { AgentChoice } from '../../../src/shared/generated/AgentChoice'
import type { RunnerCommand } from '../../../src/shared/generated/RunnerCommand'
import type { RunnerEvent } from '../../../src/shared/generated/RunnerEvent'
import type { RunnerToWorkspace } from '../../../src/shared/generated/RunnerToWorkspace'
interface Turn {
  sessionId: string
  turnId: string
  messageIds: Set<string>
  startedAt: number
  text: string
  hold: boolean
  timers: Set<ReturnType<typeof setTimeout>>
}

export class BrowserRunnerAgent {
  private readonly seen = new Set<string>()
  private readonly turns = new Map<string, Turn>()
  private sequence = 0
  private readonly emit: (event: RunnerEvent) => void
  private readonly send: (message: RunnerToWorkspace) => void

  constructor(
    emit: (event: RunnerEvent) => void,
    send: (message: RunnerToWorkspace) => void,
  ) {
    this.emit = emit
    this.send = send
  }

  status() {
    return {
      turnCount: this.sequence,
      activeTurns: [...this.turns.values()].map((turn) => ({
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        waitingForStop: turn.hold,
      })),
    }
  }

  command(command: RunnerCommand): void {
    if (command.type === 'file.read' || command.type === 'file.diff') {
      this.send({
        type:
          command.type === 'file.read'
            ? 'file.read.result'
            : 'file.diff.result',
        requestId: command.requestId,
        result: {
          ok: false,
          error: {
            code: 'file_unavailable',
            message: 'This file is not available.',
          },
        },
      })
      return
    }
    if (this.seen.has(command.commandId)) return
    this.seen.add(command.commandId)
    if (command.type === 'turn') {
      const turn: Turn = {
        sessionId: command.sessionId,
        turnId: command.turnId,
        messageIds: new Set([command.message.id]),
        startedAt: Date.now(),
        text: '',
        hold: ++this.sequence === 1,
        timers: new Set(),
      }
      this.turns.set(turn.turnId, turn)
      this.started(turn, command.message.sender.id, command.message.choice)
      const chunks = turn.hold
        ? [
            'I am checking the repository. ',
            'The workspace connection is live. ',
            'Use Stop when you have seen this response.',
          ]
        : [
            'Your next message stays in the same session. ',
            'The cloud computer is ready. ',
            'This response has finished.',
          ]
      chunks.forEach((text, index) => {
        const timer = setTimeout(
          () => {
            turn.timers.delete(timer)
            this.delta(turn, text)
            if (index === chunks.length - 1 && !turn.hold)
              this.finish(turn, 'finished')
          },
          (index + 1) * 400,
        )
        turn.timers.add(timer)
      })
    } else if (command.type === 'message') {
      const turn = this.turns.get(command.turnId)
      if (turn) {
        turn.messageIds.add(command.message.id)
        this.delta(turn, ' I received your added message.')
      }
    } else if (command.type === 'interrupt') {
      const turn = this.turns.get(command.turnId)
      if (turn) this.finish(turn, 'stopped')
    } else if (
      command.type === 'report.refresh' &&
      command.kind === 'workspace.title'
    ) {
      this.emit({ type: 'workspace.title', name: 'Check workspace connection' })
    }
  }

  private started(turn: Turn, senderId: string, choice: AgentChoice): void {
    this.emit({
      type: 'turn.started',
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      senderId,
      choice,
      startedAt: turn.startedAt,
      messageIds: [...turn.messageIds],
    })
    this.emit({
      type: 'turn.thinking',
      sessionId: turn.sessionId,
      turnId: turn.turnId,
    })
  }

  private delta(turn: Turn, text: string): void {
    turn.text += text
    this.emit({
      type: 'assistant.delta',
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      messageId: `browser-answer-${turn.turnId}`,
      text,
    })
  }

  private finish(turn: Turn, state: 'finished' | 'stopped'): void {
    for (const timer of turn.timers) clearTimeout(timer)
    if (state === 'finished')
      this.emit({
        type: 'assistant.completed',
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        messageId: `browser-answer-${turn.turnId}`,
        text: turn.text,
        userMessageIds: [...turn.messageIds],
      })
    this.emit({
      type: 'turn.completed',
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      state,
      durationMs: Date.now() - turn.startedAt,
      files: [],
      omittedFileCount: 0,
      userMessageIds: [...turn.messageIds],
    })
    this.turns.delete(turn.turnId)
  }

  stop(): void {
    for (const turn of this.turns.values())
      for (const timer of turn.timers) clearTimeout(timer)
    this.turns.clear()
  }
}
