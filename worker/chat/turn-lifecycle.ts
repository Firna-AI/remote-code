import type { Session } from '../../src/shared/generated/Session'
import type { AgentChatEvent } from '../../src/shared/generated/AgentChatEvent'
import type { TurnStopRequester } from '../../src/shared/session-stop'
import { recordStopRequest } from './stop-request'

import { HttpError } from '../http'
import { TurnCompletion, type TurnEnd } from './turn-completion'
import type { ChatTransaction } from './store'
import type { PendingCommand, StoredTurn } from './types'

/** Owns the active turn and its stored chain of waiting turns. */
export class TurnLifecycle {
  private readonly transaction: ChatTransaction
  private readonly session: Session

  constructor(transaction: ChatTransaction, session: Session) {
    this.transaction = transaction
    this.session = session
  }

  async select(senderId: string, randomId: () => string): Promise<StoredTurn> {
    let turn = this.session.activeTurnId
      ? await this.transaction.turn(this.session.activeTurnId)
      : undefined
    while (turn) {
      if (!turn.nextTurnId && turn.state !== 'stopping') return turn
      const following = turn.nextTurnId
        ? await this.transaction.turn(turn.nextTurnId)
        : undefined
      if (following) {
        turn = following
      } else {
        const waiting = this.create(senderId, randomId())
        turn.nextTurnId = waiting.id
        await this.transaction.saveTurn(turn)
        await this.transaction.saveTurn(waiting)
        return waiting
      }
    }
    turn = this.create(senderId, randomId())
    this.session.activeTurnId = turn.id
    await this.transaction.saveTurn(turn)
    return turn
  }

  async canDispatch(command: PendingCommand): Promise<boolean> {
    if (command.type === 'model') {
      const active = this.session.activeTurnId
        ? await this.transaction.turn(this.session.activeTurnId)
        : undefined
      return active?.state !== 'queued'
    }
    if (
      this.session.closedAt !== null ||
      this.session.activeTurnId !== command.turnId
    )
      return false
    const turn = await this.transaction.turn(command.turnId)
    if (command.type === 'interrupt') return turn?.state === 'stopping'
    if (command.type === 'message') return turn?.state === 'running'
    return turn?.state === 'queued' || turn?.state === 'running'
  }

  private async finish(
    turn: StoredTurn,
    end: TurnEnd,
    occurredAt = this.transaction.now,
  ): Promise<void> {
    await new TurnCompletion(this.transaction, this.session).finish(
      turn,
      end,
      occurredAt,
    )
  }

  async runnerEnded(
    turn: StoredTurn,
    event: Extract<
      AgentChatEvent,
      { type: 'turn.completed' | 'turn.failed' }
    > | null,
    occurredAt: number,
    randomId: () => string,
  ): Promise<void> {
    const failed = !!turn.loginFailure
    if (event && !failed) await this.transaction.emit(event, occurredAt)
    await this.finish(
      turn,
      event?.type === 'turn.completed'
        ? event.state === 'finished'
          ? { state: 'finished', randomId }
          : { state: 'stopped' }
        : {
            state: 'failed',
            ...(event ? { retryMessageId: event.retryMessageId } : {}),
            error:
              event?.type === 'turn.failed'
                ? event.error
                : {
                    code: 'runner_event_refused',
                    message:
                      'The agent could not finish. Try again in the workspace.',
                  },
          },
      occurredAt,
    )
    if (event && failed) await this.transaction.emit(event, occurredAt, true)
  }

  async workspaceStopped(turn: StoredTurn): Promise<void> {
    await new TurnCompletion(this.transaction, this.session).stopped(turn)
  }

  async fail(
    turnId: string,
    cause: string,
    randomId: () => string,
    completion: 'after-runner' | 'immediate' = 'after-runner',
  ): Promise<void> {
    const turn = await this.transaction.turn(turnId)
    if (
      !turn ||
      turn.sessionId !== this.session.id ||
      !['queued', 'running', 'stopping'].includes(turn.state)
    )
      return
    turn.loginFailure ??= cause
    await this.transaction.saveTurn(turn)
    if (turn.state === 'queued' || completion === 'immediate') {
      const running = turn.state !== 'queued'
      await this.finish(turn, { state: 'failed' })
      if (running)
        await this.transaction.saveCommand({
          type: 'interrupt',
          commandId: randomId(),
          sessionId: this.session.id,
          turnId,
        })
    } else await this.stop(turn.id, randomId())
  }

  async stop(turnId: string, commandId: string, requester?: TurnStopRequester) {
    const turn = await this.transaction.turn(turnId)
    if (!turn || turn.sessionId !== this.session.id) {
      throw new HttpError(404, 'turn_not_found', 'The turn is not available.')
    }
    if (requester) await recordStopRequest(this.transaction, turn, requester)
    if (
      turn.state === 'finished' ||
      turn.state === 'failed' ||
      turn.state === 'stopped'
    ) {
      return { turnId, state: 'stopped' as const }
    }
    if (turn.state === 'queued') {
      await this.workspaceStopped(turn)
      return { turnId, state: 'stopped' as const }
    }
    if (turn.state !== 'stopping') {
      turn.state = 'stopping'
      await this.transaction.saveTurn(turn)
      await this.transaction.saveCommand({
        type: 'interrupt',
        commandId,
        sessionId: this.session.id,
        turnId,
      })
    }
    return { turnId, state: 'stopping' as const }
  }

  async close(
    stopRunning: boolean,
    commandId: string,
    requester?: TurnStopRequester,
  ): Promise<Session> {
    const turn = this.session.activeTurnId
      ? await this.transaction.turn(this.session.activeTurnId)
      : undefined
    if (turn) {
      if (turn.state !== 'queued' && !stopRunning) {
        throw new HttpError(
          409,
          'stop_confirmation_required',
          'Confirm Stop to close this session.',
        )
      }
      turn.closeAfterStop = true
      await this.transaction.saveTurn(turn)
      await this.stop(turn.id, commandId, requester)
    } else if (this.session.closedAt === null) {
      this.session.closedAt = this.transaction.now
      await new TurnCompletion(this.transaction, this.session).saveSession()
    }
    return this.session
  }

  private create(senderId: string, id: string): StoredTurn {
    return {
      id,
      sessionId: this.session.id,
      senderId,
      messageIds: [],
      state: 'queued',
      closeAfterStop: false,
      nextTurnId: null,
    }
  }
}
