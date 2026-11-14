//! Wire-order command routing and independent session ownership.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner_interface::runner_commands::{
    RunnerChangeModel, RunnerCommand, RunnerControlCommand, RunnerInterrupt, RunnerTurn,
};
use cnd_runner_interface::runner_credentials::{CodexTurnCredential, RunnerTurnCredential};
use futures_util::future::BoxFuture;
use tokio::sync::{mpsc, oneshot};

use crate::error::{Error, Result};
use crate::runtime::CommandHandler;
use crate::state::records::{RunnerState, SavedTurn};

use super::actor::run;
use super::control::Control;
use super::dependencies::EngineDependencies;
use super::types::{Session, Work};

struct SessionHandle {
    mailbox: mpsc::UnboundedSender<Work>,
    controls: Arc<Mutex<BTreeMap<String, Control>>>,
}
#[derive(Default)]
struct Registry {
    sessions: BTreeMap<String, SessionHandle>,
    commands: BTreeSet<String>,
    turns: BTreeSet<(String, String)>,
}

/// Agent engine supplied as the final command handler after report handling.
pub struct AgentEngine {
    dependencies: Arc<EngineDependencies>,
    loaded: RunnerState,
    registry: Mutex<Registry>,
    closed: AtomicBool,
    welcomed: AtomicBool,
}

impl AgentEngine {
    /// Compose from loaded state. RunnerCore recovers unfinished turns before start.
    pub fn new(dependencies: EngineDependencies, loaded: RunnerState) -> Self {
        Self {
            dependencies: Arc::new(dependencies),
            loaded,
            registry: Mutex::new(Registry::default()),
            closed: AtomicBool::new(false),
            welcomed: AtomicBool::new(false),
        }
    }

    /// Wait for queued commands and flush each session's streaming text.
    pub async fn idle(&self) -> Result<()> {
        let mailboxes: Vec<_> = self
            .registry
            .lock()
            .or(Err(Error::InvalidCommand))?
            .sessions
            .values()
            .map(|s| s.mailbox.clone())
            .collect();
        for mailbox in mailboxes {
            let (sender, receiver) = oneshot::channel();
            if mailbox.send(Work::Idle(sender)).is_ok() {
                let _ = receiver.await;
            }
        }
        Ok(())
    }
}

fn route(command: &RunnerCommand) -> Option<(&str, &str, Option<&str>)> {
    match command {
        RunnerCommand::RunnerTurn(RunnerTurn::Turn {
            command_id,
            session_id,
            turn_id,
            ..
        }) => Some((command_id, session_id, Some(turn_id))),
        RunnerCommand::RunnerMessageDuringTurn(
            cnd_runner_interface::runner_commands::RunnerMessageDuringTurn::Message {
                command_id,
                session_id,
                ..
            },
        ) => Some((command_id, session_id, None)),
        RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerInterrupt(
            RunnerInterrupt::Interrupt {
                command_id,
                session_id,
                turn_id,
            },
        )) => Some((command_id, session_id, Some(turn_id))),
        RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerChangeModel(
            RunnerChangeModel::Model {
                command_id,
                session_id,
                ..
            },
        )) => Some((command_id, session_id, None)),
        _ => None,
    }
}

#[async_trait]
impl CommandHandler for AgentEngine {
    async fn start(&self) -> Result<()> {
        self.dependencies.startup.prepare().await
    }
    fn connected(&self) -> BoxFuture<'static, Result<()>> {
        let first = !self.welcomed.swap(true, Ordering::AcqRel);
        let startup = self.dependencies.startup.clone();
        Box::pin(async move {
            if first && startup.welcomed().await.is_err() {
                tracing::warn!("The connected runner release could not be confirmed.");
            }
            Ok(())
        })
    }
    fn command(&self, command: RunnerCommand) -> Result<()> {
        if self.closed.load(Ordering::Acquire) {
            return Ok(());
        }
        let Some((command_id, session_id, turn_id)) = route(&command) else {
            return Ok(());
        };
        let mut registry = self.registry.lock().or(Err(Error::InvalidCommand))?;
        if self.closed.load(Ordering::Acquire) || !registry.commands.insert(command_id.to_owned()) {
            return Ok(());
        }
        let session_id = session_id.to_owned();
        if let Some(turn_id) = turn_id {
            if self
                .loaded
                .turns
                .iter()
                .any(|t| t.session_id == session_id && t.turn_id == turn_id)
            {
                return Ok(());
            }
            if matches!(&command, RunnerCommand::RunnerTurn(_))
                && registry
                    .turns
                    .contains(&(session_id.clone(), turn_id.to_owned()))
            {
                return Ok(());
            }
            registry
                .turns
                .insert((session_id.clone(), turn_id.to_owned()));
        }
        let starting = matches!(&command, RunnerCommand::RunnerTurn(_));
        let interrupt = matches!(
            &command,
            RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerInterrupt(_))
        );
        if !registry.sessions.contains_key(&session_id) {
            if !starting && !interrupt {
                if matches!(&command, RunnerCommand::RunnerMessageDuringTurn(_)) {
                    tracing::warn!("The message targets a turn that is not running.");
                }
                return Ok(());
            }
            let (mailbox, receiver) = mpsc::unbounded_channel();
            let controls = Arc::new(Mutex::new(BTreeMap::new()));
            let session = Session {
                id: session_id.clone(),
                dependencies: self.dependencies.clone(),
                saved: self
                    .loaded
                    .sessions
                    .iter()
                    .find(|s| s.session_id == session_id)
                    .cloned(),
                choice: None,
                active: None,
                generation: 0,
                controls: controls.clone(),
                mailbox: mailbox.clone(),
                ended: BTreeSet::new(),
            };
            tokio::spawn(run(session, receiver));
            registry
                .sessions
                .insert(session_id.clone(), SessionHandle { mailbox, controls });
        }
        let session = registry
            .sessions
            .get(&session_id)
            .ok_or(Error::InvalidCommand)?;
        let received_at = self.dependencies.clock.now()?;
        let mut accepted = None;
        if let RunnerCommand::RunnerTurn(RunnerTurn::Turn {
            turn_id,
            message,
            credential,
            ..
        }) = &command
        {
            let token = match credential {
                RunnerTurnCredential::Claude { token, .. }
                | RunnerTurnCredential::Codex {
                    credential:
                        CodexTurnCredential::ApiKey { token } | CodexTurnCredential::Token { token, .. },
                } => token,
            };
            self.dependencies.credentials.add(token.clone())?;
            session
                .controls
                .lock()
                .or(Err(Error::InvalidCommand))?
                .insert(turn_id.clone(), Control::default());
            let store = self.dependencies.store.clone();
            let record = SavedTurn {
                session_id,
                turn_id: turn_id.clone(),
                started_at: received_at.max(0) as u64,
                message_ids: vec![message.id.clone()],
                start_event_number: None,
                end_event_number: None,
            };
            accepted = Some(tokio::spawn(async move { store.accept_turn(record).await }));
        }
        if let RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerInterrupt(
            RunnerInterrupt::Interrupt { turn_id, .. },
        )) = &command
            && let Some(control) = session
                .controls
                .lock()
                .or(Err(Error::InvalidCommand))?
                .get(turn_id)
        {
            control.stop();
        }
        session
            .mailbox
            .send(Work::Command(Box::new(command), received_at, accepted))
            .or(Err(Error::Canceled))
    }
    async fn shutdown(&self) -> Result<()> {
        self.closed.store(true, Ordering::Release);
        let receivers = {
            let registry = self.registry.lock().or(Err(Error::InvalidCommand))?;
            let mut receivers = vec![];
            for session in registry.sessions.values() {
                for control in session
                    .controls
                    .lock()
                    .or(Err(Error::InvalidCommand))?
                    .values()
                {
                    control.stop();
                }
                let (sender, receiver) = oneshot::channel();
                let _ = session.mailbox.send(Work::Shutdown(sender));
                receivers.push(receiver);
            }
            receivers
        };
        for receiver in receivers {
            let _ = receiver.await;
        }
        self.dependencies.store.persist().await
    }
}
