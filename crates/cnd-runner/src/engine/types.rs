//! Per-session state and ordered actor messages.

use std::collections::{BTreeSet, VecDeque};
use std::sync::Arc;

use cnd_runner_interface::agents::AgentChoice;
use cnd_runner_interface::chat_events::TurnSpeed;
use cnd_runner_interface::runner_commands::{RunnerCommand, RunnerTurn};
use cnd_runner_interface::sdk_helper::HelperOutput;
use cnd_runner_interface::sdk_helper_options::ProviderInput;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::error::Result;
use crate::helper::boundary::Helper;
use crate::repository::service::Checkpoint;
use crate::state::records::SavedSession;

use super::background::Background;
use super::control::Control;
use super::dependencies::EngineDependencies;
use super::output::TurnOutput;

pub(super) enum Work {
    Command(Box<RunnerCommand>, i64, Option<JoinHandle<Result<()>>>),
    Output(u64, HelperOutput),
    Idle(oneshot::Sender<()>),
    Shutdown(oneshot::Sender<()>),
}

pub(super) struct ActiveTurn {
    pub(super) first: RunnerTurn,
    pub(super) control: Control,
    pub(super) started_at: i64,
    pub(super) retry_message_id: String,
    pub(super) message_ids: Vec<String>,
    pub(super) resolved: BTreeSet<String>,
    pub(super) waiting: VecDeque<ProviderInput>,
    pub(super) helper: Option<Arc<dyn Helper>>,
    pub(super) baseline: Option<Checkpoint>,
    pub(super) output: TurnOutput,
    pub(super) background: Option<Background>,
    pub(super) notes: BTreeSet<String>,
    pub(super) speed: Option<TurnSpeed>,
}

pub(super) struct Session {
    pub(super) id: String,
    pub(super) dependencies: Arc<EngineDependencies>,
    pub(super) saved: Option<SavedSession>,
    pub(super) choice: Option<AgentChoice>,
    pub(super) active: Option<ActiveTurn>,
    pub(super) generation: u64,
    pub(super) controls: Arc<std::sync::Mutex<std::collections::BTreeMap<String, Control>>>,
    pub(super) ended: BTreeSet<String>,
    pub(super) mailbox: mpsc::UnboundedSender<Work>,
}

pub(super) fn identity(
    input: &ProviderInput,
) -> (&str, &str, &cnd_runner_interface::messages::UserMessage) {
    match input {
        ProviderInput::Turn(RunnerTurn::Turn {
            session_id,
            turn_id,
            message,
            ..
        }) => (session_id, turn_id, message),
        ProviderInput::Message(
            cnd_runner_interface::runner_commands::RunnerMessageDuringTurn::Message {
                session_id,
                turn_id,
                message,
                ..
            },
        ) => (session_id, turn_id, message),
    }
}

pub(super) enum End {
    Result(
        cnd_runner_interface::provider_events::ProviderResultState,
        Option<cnd_runner_interface::chat_events::TurnEndReason>,
    ),
    Failed(crate::error::Error),
}
