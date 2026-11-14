//! Close agent and helper before exactly one durable turn end.

use std::time::Duration;

use cnd_runner_interface::chat_events::{
    AgentChatEvent, AgentChatEventTurnCompletedState, AgentChatEventTurnFailedError, ToolCallState,
    TurnEventContext,
};
use cnd_runner_interface::provider_events::ProviderResultState;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::wire::WireTrue;

use crate::error::{Error, Result};
use crate::repository::git::Cancellation;

use super::types::{End, Session};

pub(super) fn failure(error: Error) -> AgentChatEventTurnFailedError {
    match error {
        Error::Agent { code, message } => AgentChatEventTurnFailedError { code, message },
        Error::HelperExited => AgentChatEventTurnFailedError {
            code: "agent_exited".into(),
            message: "The SDK helper process ended.".into(),
        },
        error => AgentChatEventTurnFailedError {
            code: "agent_failed".into(),
            message: error.to_string(),
        },
    }
}

impl Session {
    pub(super) async fn emit(&mut self, events: Vec<AgentChatEvent>) -> Result<()> {
        for event in &events {
            if let AgentChatEvent::TurnCompleted {
                turn_event_context, ..
            }
            | AgentChatEvent::TurnFailed {
                turn_event_context, ..
            } = event
            {
                self.ended.insert(turn_event_context.turn_id.clone());
            }
        }
        self.dependencies
            .emitter
            .emit(
                events
                    .into_iter()
                    .map(RunnerEvent::AgentChatEvent)
                    .collect(),
                None,
            )
            .await
    }

    pub(super) async fn pending_end(&mut self, context: TurnEventContext) -> Result<()> {
        if self.ended.contains(&context.turn_id) {
            return self.dependencies.emitter.persist().await;
        }
        self.emit(vec![AgentChatEvent::TurnCompleted {
            turn_event_context: context,
            state: AgentChatEventTurnCompletedState::Stopped,
            duration_ms: 0,
            end_reason: None,
            speed: None,
            files: vec![],
            files_unavailable: None,
            omitted_file_count: 0,
            user_message_ids: vec![],
        }])
        .await
    }

    pub(super) async fn finish(&mut self, end: End) -> Result<()> {
        let Some(mut turn) = self.active.take() else {
            return Ok(());
        };
        let context = turn.output_context();
        let now = match self.dependencies.clock.now() {
            Ok(now) => now,
            Err(_) => {
                tracing::warn!("The turn duration could not be read.");
                turn.started_at
            }
        };
        let duration_ms = now.saturating_sub(turn.started_at).max(0) as u64;
        let stopped =
            turn.control.stopped() || matches!(&end, End::Result(ProviderResultState::Stopped, _));
        let tool_state = if stopped {
            ToolCallState::Stopped
        } else if matches!(&end, End::Failed(_)) {
            ToolCallState::Failed
        } else {
            ToolCallState::Done
        };
        if self.emit(turn.output.finish(tool_state)).await.is_err() {
            tracing::warn!("The final agent output could not be saved.");
        }
        self.generation += 1;
        if let Some(helper) = turn.helper.take()
            && helper.close().await.is_err()
        {
            tracing::warn!("The canceled agent could not close.");
        }
        let mut files = None;
        if let Some(baseline) = &turn.baseline {
            if !turn.control.stopped() && matches!(&end, End::Result(..)) {
                let repository = self
                    .dependencies
                    .repositories
                    .open(turn.control.repository.clone());
                files = turn
                    .control
                    .run(async {
                        repository
                            .changed_since(
                                self.dependencies.configuration.default_branch.clone(),
                                baseline.clone(),
                            )
                            .await
                            .or(Err(Error::Checkpoint))
                    })
                    .await
                    .ok();
            }
            if turn.control.stopped() && files.is_none() {
                let cancellation = Cancellation::default();
                let repository = self.dependencies.repositories.open(cancellation.clone());
                let read = repository.changed_since(
                    self.dependencies.configuration.default_branch.clone(),
                    baseline.clone(),
                );
                match tokio::time::timeout(Duration::from_secs(10), read).await {
                    Ok(Ok(changed)) => files = Some(changed),
                    _ => cancellation.cancel(),
                }
            }
        }
        let stopped = stopped || turn.control.stopped();
        let event = match end {
            End::Failed(error) if !stopped => AgentChatEvent::TurnFailed {
                turn_event_context: context,
                error: failure(error),
                retry_message_id: turn.retry_message_id,
                duration_ms,
            },
            end => {
                let end_reason = match end {
                    End::Result(_, reason) if !stopped => reason,
                    _ => None,
                };
                let unavailable = turn.baseline.is_some() && files.is_none();
                if unavailable {
                    tracing::warn!("The changed files could not be read.");
                }
                AgentChatEvent::TurnCompleted {
                    turn_event_context: context,
                    state: if stopped {
                        AgentChatEventTurnCompletedState::Stopped
                    } else {
                        AgentChatEventTurnCompletedState::Finished
                    },
                    duration_ms,
                    end_reason,
                    speed: turn.speed,
                    files: files.unwrap_or_default(),
                    files_unavailable: unavailable.then_some(WireTrue),
                    omitted_file_count: 0,
                    user_message_ids: turn.message_ids,
                }
            }
        };
        self.emit(vec![event]).await
    }
}
