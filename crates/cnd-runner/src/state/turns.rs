//! Atomic start/end records and stopped recovery events.

use cnd_runner_interface::chat_events::{
    AgentChatEvent, AgentChatEventTurnCompletedState, TurnEventContext,
};
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;
use cnd_runner_interface::wire::WireTrue;

use super::records::{RunnerState, SavedTurn};

pub(super) fn pending_end(state: &RunnerState, event: &RunnerEvent) -> Option<RunnerEventEnvelope> {
    let RunnerEvent::AgentChatEvent(
        AgentChatEvent::TurnCompleted {
            turn_event_context, ..
        }
        | AgentChatEvent::TurnFailed {
            turn_event_context, ..
        },
    ) = event
    else {
        return None;
    };
    let number = state
        .turns
        .iter()
        .find(|t| matches_context(t, turn_event_context))?
        .end_event_number?;
    state
        .outbox
        .iter()
        .find(|RunnerEventEnvelope::Event { event_number, .. }| *event_number == number)
        .cloned()
}

pub(super) fn record(state: &mut RunnerState, event: &RunnerEvent, number: u64, now: i64) {
    let RunnerEvent::AgentChatEvent(event) = event else {
        return;
    };
    let (context, start, messages, started_at) = match event {
        AgentChatEvent::TurnStarted {
            turn_event_context,
            message_ids,
            started_at,
            ..
        } => (
            turn_event_context,
            true,
            message_ids.clone(),
            started_at.0 as u64,
        ),
        AgentChatEvent::TurnCompleted {
            turn_event_context,
            user_message_ids,
            duration_ms,
            ..
        } => (
            turn_event_context,
            false,
            user_message_ids.clone(),
            (now as u64).saturating_sub(*duration_ms),
        ),
        AgentChatEvent::TurnFailed {
            turn_event_context,
            retry_message_id,
            duration_ms,
            ..
        } => (
            turn_event_context,
            false,
            vec![retry_message_id.clone()],
            (now as u64).saturating_sub(*duration_ms),
        ),
        _ => return,
    };
    if let Some(turn) = state.turns.iter_mut().find(|t| matches_context(t, context)) {
        if start {
            turn.start_event_number.get_or_insert(number);
        } else {
            turn.end_event_number.get_or_insert(number);
        }
    } else {
        state.turns.push(SavedTurn {
            session_id: context.session_id.clone(),
            turn_id: context.turn_id.clone(),
            started_at,
            message_ids: messages,
            start_event_number: start.then_some(number),
            end_event_number: (!start).then_some(number),
        });
    }
}

fn matches_context(turn: &SavedTurn, context: &TurnEventContext) -> bool {
    turn.session_id == context.session_id && turn.turn_id == context.turn_id
}

pub(super) fn recovered_end(turn: &SavedTurn, now: i64) -> RunnerEvent {
    RunnerEvent::AgentChatEvent(AgentChatEvent::TurnCompleted {
        turn_event_context: TurnEventContext {
            session_id: turn.session_id.clone(),
            turn_id: turn.turn_id.clone(),
        },
        state: AgentChatEventTurnCompletedState::Stopped,
        duration_ms: (now as u64).saturating_sub(turn.started_at),
        end_reason: None,
        speed: None,
        files: vec![],
        files_unavailable: turn.start_event_number.map(|_| WireTrue),
        omitted_file_count: 0,
        user_message_ids: turn.message_ids.clone(),
    })
}
