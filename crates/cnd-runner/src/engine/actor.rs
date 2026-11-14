//! Ordered session work with cancellation outside the mailbox.

use std::time::Duration;

use cnd_runner_interface::chat_events::{AgentChatEvent, TurnEndReason, TurnEventContext};
use cnd_runner_interface::provider_events::ProviderResultState;
use cnd_runner_interface::runner_commands::{
    RunnerChangeModel, RunnerCommand, RunnerControlCommand, RunnerInterrupt, RunnerTurn,
};
use cnd_runner_interface::sdk_helper_options::ProviderInput;
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::error::{Error, ErrorResultExt, Result};

use super::control::Control;
use super::finish::failure;
use super::types::{End, Session, Work};

pub(super) async fn run(mut session: Session, mut receiver: mpsc::UnboundedReceiver<Work>) {
    loop {
        let flush = session.active.as_ref().and_then(|turn| turn.output.due);
        if flush.is_some_and(|due| Instant::now() >= due) {
            let events = session
                .active
                .as_mut()
                .map(|turn| turn.output.flush())
                .unwrap_or_default();
            let _ = session.emit(events).await;
            continue;
        }
        let now = session.dependencies.clock.now().unwrap_or_default();
        let deadline = session
            .active
            .as_ref()
            .and_then(|turn| turn.background.as_ref())
            .filter(|b| b.waiting)
            .and_then(|b| b.deadline);
        let expires = deadline.map(|due| {
            Instant::now() + Duration::from_millis(due.saturating_sub(now).max(0) as u64)
        });
        let timer = flush.into_iter().chain(expires).min();
        let work = tokio::select! {
            biased;
            work = receiver.recv() => work,
            _ = async { if let Some(due) = timer { tokio::time::sleep_until(due).await; } else { std::future::pending::<()>().await; } } => {
                if flush.is_some_and(|due| Instant::now() >= due) { let events = session.active.as_mut().map(|t| t.output.flush()).unwrap_or_default(); let _ = session.emit(events).await; }
                if deadline.is_some_and(|deadline| session.dependencies.clock.now().unwrap_or_default() >= deadline) { let _ = session.finish(End::Result(ProviderResultState::Finished, Some(TurnEndReason::BackgroundWorkLimit))).await; }
                continue;
            },
        };
        let Some(work) = work else {
            break;
        };
        match work {
            Work::Shutdown(done) => {
                let _ = session
                    .finish(End::Result(ProviderResultState::Stopped, None))
                    .await;
                let pending: Vec<_> = session
                    .controls
                    .lock()
                    .map(|controls| controls.keys().cloned().collect())
                    .unwrap_or_default();
                for turn_id in pending {
                    if !session.ended.contains(&turn_id) {
                        let _ = session
                            .pending_end(TurnEventContext {
                                session_id: session.id.clone(),
                                turn_id,
                            })
                            .await;
                    }
                }
                let _ = done.send(());
                break;
            }
            Work::Idle(done) => {
                let events = session
                    .active
                    .as_mut()
                    .map(|t| t.output.flush())
                    .unwrap_or_default();
                let _ = session.emit(events).await;
                let _ = done.send(());
            }
            Work::Output(generation, output) => {
                if generation == session.generation
                    && let Err(error) = session.output(output).await
                {
                    let _ = session.finish(End::Failed(error)).await;
                }
            }
            Work::Command(command, received_at, accepted) => {
                let control = match command.as_ref() {
                    RunnerCommand::RunnerTurn(RunnerTurn::Turn { turn_id, .. }) => session
                        .controls
                        .lock()
                        .ok()
                        .and_then(|c| c.get(turn_id).cloned())
                        .unwrap_or_default(),
                    _ => session
                        .active
                        .as_ref()
                        .map(|t| t.control.clone())
                        .unwrap_or_default(),
                };
                let action = async {
                    if let Some(accepted) = accepted {
                        control.run(async { accepted.await.internal()? }).await?;
                    }
                    session
                        .command(command.as_ref().clone(), control.clone(), received_at)
                        .await
                }
                .await;
                if let Err(error) = action {
                    let _ = session.command_failed(*command, control, error).await;
                }
            }
        }
    }
}

impl Session {
    async fn command(
        &mut self,
        command: RunnerCommand,
        control: Control,
        received_at: i64,
    ) -> Result<()> {
        match command {
            RunnerCommand::RunnerTurn(turn) => {
                self.input(ProviderInput::Turn(turn), control, received_at)
                    .await
            }
            RunnerCommand::RunnerMessageDuringTurn(message) => {
                self.input(ProviderInput::Message(message), control, received_at)
                    .await
            }
            RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerChangeModel(
                RunnerChangeModel::Model { choice, .. },
            )) => {
                if self.saved.as_ref().is_some_and(|s| s.agent == choice.agent) {
                    self.choice = Some(choice.clone());
                    if let Some(turn) = &self.active
                        && let Some(helper) = &turn.helper
                    {
                        turn.control.run(helper.model(choice)).await?;
                    }
                }
                Ok(())
            }
            RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerInterrupt(
                RunnerInterrupt::Interrupt {
                    session_id,
                    turn_id,
                    ..
                },
            )) => {
                if self
                    .active
                    .as_ref()
                    .is_some_and(|t| t.output_context().turn_id == turn_id)
                {
                    self.finish(End::Result(ProviderResultState::Stopped, None))
                        .await
                } else {
                    self.pending_end(TurnEventContext {
                        session_id,
                        turn_id,
                    })
                    .await
                }
            }
            _ => Ok(()),
        }
    }

    async fn command_failed(
        &mut self,
        command: RunnerCommand,
        control: Control,
        error: Error,
    ) -> Result<()> {
        let context = match &command {
            RunnerCommand::RunnerTurn(RunnerTurn::Turn {
                session_id,
                turn_id,
                ..
            }) => Some(TurnEventContext {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
            }),
            RunnerCommand::RunnerMessageDuringTurn(
                cnd_runner_interface::runner_commands::RunnerMessageDuringTurn::Message {
                    session_id,
                    turn_id,
                    ..
                },
            ) => Some(TurnEventContext {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
            }),
            _ => None,
        };
        if self
            .active
            .as_ref()
            .is_some_and(|t| context.as_ref().is_none_or(|c| *c == t.output_context()))
        {
            return self.finish(End::Failed(error)).await;
        }
        if let RunnerCommand::RunnerTurn(RunnerTurn::Turn { message, .. }) = command
            && let Some(context) = context
        {
            if control.stopped() {
                return Ok(());
            }
            return self
                .emit(vec![AgentChatEvent::TurnFailed {
                    turn_event_context: context,
                    error: failure(error),
                    retry_message_id: message.id,
                    duration_ms: 0,
                }])
                .await;
        }
        tracing::warn!("The agent command could not finish.");
        Ok(())
    }
}
