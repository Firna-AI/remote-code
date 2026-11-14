//! Ordered workspace input and stale connection suppression.

use cnd_runner_interface::runner_handshake::{
    RunnerConfirm, RunnerResend, RunnerWelcome, WorkspaceToRunner,
};

use crate::error::{Error, Result};

use super::connection::SavedRunnerLink;
use super::ports::LinkUpdate;

impl SavedRunnerLink {
    pub(super) async fn next_message(&self) -> Result<LinkUpdate> {
        let _message = self.messages.lock().await;
        let (generation, socket) = {
            let active = self.connection.lock().await;
            let Some(socket) = &active.socket else {
                return Ok(LinkUpdate::Disconnected);
            };
            (active.generation, socket.clone())
        };
        let result = match socket.receive().await {
            Ok(Some(message)) => self.receive(message, generation).await,
            Ok(None) => {
                self.disconnect(generation).await;
                Ok(LinkUpdate::Disconnected)
            }
            Err(error) => Err(error),
        };
        if result.is_err() {
            self.disconnect(generation).await;
        }
        result
    }

    async fn receive(&self, message: WorkspaceToRunner, generation: u64) -> Result<LinkUpdate> {
        let welcomed = {
            let active = self.connection.lock().await;
            if active.generation != generation {
                return Ok(LinkUpdate::Progress);
            }
            active.welcomed
        };
        let stream = self.store.snapshot().await.stream_id;
        match message {
            WorkspaceToRunner::RunnerWelcome(RunnerWelcome::Welcome {
                stream_id,
                confirmed_through,
                ..
            }) => {
                if welcomed || stream_id != stream {
                    return Err(Error::InvalidWelcome);
                }
                self.store.confirm(confirmed_through).await?;
                {
                    let mut active = self.connection.lock().await;
                    if active.generation != generation {
                        return Ok(LinkUpdate::Progress);
                    }
                    active.welcomed = true;
                }
                self.resend(confirmed_through + 1).await;
                Ok(LinkUpdate::Connected)
            }
            WorkspaceToRunner::RunnerConfirm(RunnerConfirm::Confirm {
                stream_id,
                through_event_number,
            }) => {
                if welcomed && stream_id == stream {
                    self.store.confirm(through_event_number).await?;
                }
                Ok(LinkUpdate::Progress)
            }
            WorkspaceToRunner::RunnerResend(RunnerResend::Resend {
                stream_id,
                from_event_number,
            }) => {
                if welcomed && stream_id == stream {
                    self.resend(from_event_number).await;
                }
                Ok(LinkUpdate::Progress)
            }
            WorkspaceToRunner::RunnerCommand(command) if welcomed => {
                Ok(LinkUpdate::Command(command))
            }
            _ => Ok(LinkUpdate::Progress),
        }
    }
}
