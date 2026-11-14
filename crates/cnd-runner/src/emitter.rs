//! Failed-save policy for prepared events from the file and turn owners.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::chat_events::AgentChatEvent;
use cnd_runner_interface::file_tree::RunnerFileEvent;
use cnd_runner_interface::runner::RunnerEvent;
use tokio::sync::Mutex;

use crate::error::Result;
use crate::link::ports::RunnerLink;

/// Serialized emission after the caller's credential filter has released text.
#[cfg_attr(test, unimock::unimock(api = EventEmitterMock))]
#[async_trait]
pub trait EventEmitter: Send + Sync {
    /// Retry pending state without assigning another event number.
    async fn persist(&self) -> Result<()> {
        Ok(())
    }
    /// Try each prepared event in order, even when an earlier event fails.
    async fn emit(&self, events: Vec<RunnerEvent>, report_command_id: Option<String>)
    -> Result<()>;
}

/// Retry pending output or terminal state once without numbering it again.
pub struct SavingEmitter {
    link: Arc<dyn RunnerLink>,
    queue: Mutex<()>,
}

impl SavingEmitter {
    /// Compose the event policy without performing IO.
    pub fn new(link: Arc<dyn RunnerLink>) -> Self {
        Self {
            link,
            queue: Mutex::new(()),
        }
    }
}

#[async_trait]
impl EventEmitter for SavingEmitter {
    async fn persist(&self) -> Result<()> {
        self.link.persist().await
    }
    async fn emit(
        &self,
        events: Vec<RunnerEvent>,
        report_command_id: Option<String>,
    ) -> Result<()> {
        let _emitting = self.queue.lock().await;
        let mut failure = None;
        for event in events {
            let output = matches!(
                &event,
                RunnerEvent::AgentChatEvent(
                    AgentChatEvent::TurnThinking { .. }
                        | AgentChatEvent::AssistantDelta { .. }
                        | AgentChatEvent::AssistantCompleted { .. }
                        | AgentChatEvent::ToolUpdated { .. }
                )
            );
            let terminal = matches!(
                &event,
                RunnerEvent::AgentChatEvent(
                    AgentChatEvent::TurnCompleted { .. } | AgentChatEvent::TurnFailed { .. }
                ) | RunnerEvent::RunnerReady(_)
                    | RunnerEvent::RunnerFileEvent(RunnerFileEvent::FilesUnavailable { .. })
            );
            if let Err(error) = self.link.emit(event, report_command_id.clone()).await {
                if output {
                    let _ = self.link.persist().await;
                    tracing::warn!("The agent output save failed. The turn will continue.");
                } else if terminal {
                    if let Err(error) = self.link.persist().await {
                        failure.get_or_insert(error);
                    }
                } else {
                    failure.get_or_insert(error);
                }
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
#[path = "_tests_/emitter_tests.rs"]
mod emitter_tests;
