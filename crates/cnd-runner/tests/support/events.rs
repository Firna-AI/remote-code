//! Typed events used by connection and disk integration tests.

use cnd_runner::state::records::SavedTurn;
use cnd_runner_interface::agents::{Agent, AgentChoice, Effort};
use cnd_runner_interface::api::Timestamp;
use cnd_runner_interface::chat_events::{
    AgentChatEvent, AgentChatEventTurnCompletedState, TurnEventContext,
};
use cnd_runner_interface::runner::{RunnerEvent, RunnerWorkspaceTitle};
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;

pub(crate) fn title(name: &str) -> RunnerEvent {
    RunnerEvent::RunnerWorkspaceTitle(RunnerWorkspaceTitle::WorkspaceTitle { name: name.into() })
}

pub(crate) fn accepted(id: &str) -> SavedTurn {
    SavedTurn {
        session_id: "session".into(),
        turn_id: id.into(),
        started_at: 100,
        message_ids: vec![format!("message-{id}")],
        start_event_number: None,
        end_event_number: None,
    }
}

pub(crate) fn started(id: &str) -> RunnerEvent {
    RunnerEvent::AgentChatEvent(AgentChatEvent::TurnStarted {
        turn_event_context: TurnEventContext {
            session_id: "session".into(),
            turn_id: id.into(),
        },
        sender_id: "member".into(),
        choice: AgentChoice {
            agent: Agent::Claude,
            model: "model".into(),
            effort: Effort::High,
            fast: false,
        },
        started_at: Timestamp(100),
        message_ids: vec![format!("message-{id}")],
    })
}

pub(crate) fn ended(id: &str) -> RunnerEvent {
    RunnerEvent::AgentChatEvent(AgentChatEvent::TurnCompleted {
        turn_event_context: TurnEventContext {
            session_id: "session".into(),
            turn_id: id.into(),
        },
        state: AgentChatEventTurnCompletedState::Stopped,
        duration_ms: 0,
        end_reason: None,
        speed: None,
        files: vec![],
        files_unavailable: None,
        omitted_file_count: 0,
        user_message_ids: vec![format!("message-{id}")],
    })
}

pub(crate) fn number(envelope: &RunnerEventEnvelope) -> u64 {
    let RunnerEventEnvelope::Event { event_number, .. } = envelope;
    *event_number
}
