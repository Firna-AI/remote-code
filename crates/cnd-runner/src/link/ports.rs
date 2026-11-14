//! Runner link interface and effects returned to its runtime owner.

use async_trait::async_trait;
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_commands::RunnerCommand;
use cnd_runner_interface::runner_files::RunnerFileResponse;

use crate::error::Result;

/// Result of receiving one workspace message.
#[derive(Debug, PartialEq)]
pub enum LinkUpdate {
    /// Welcome was saved and pending events were resent. Reports can start.
    Connected,
    /// An authenticated command received after welcome.
    Command(Box<RunnerCommand>),
    /// A confirmation, resend, ignored command, or stale message.
    Progress,
    /// The active socket closed.
    Disconnected,
}

/// Socket lifecycle and saved event delivery, independent of agent work.
#[cfg_attr(test, unimock::unimock(api = RunnerLinkMock))]
#[async_trait]
pub trait RunnerLink: Send + Sync {
    /// Replace any prior connection and send hello before other messages.
    async fn connect(&self) -> Result<()>;
    /// Process one message. A single runtime owner drives this method.
    /// Keep this future until it finishes or the connection ends: receipt precedes processing.
    async fn step(&self) -> Result<LinkUpdate>;
    /// Bound, number, and save an already filtered event before sending it.
    async fn emit(&self, event: RunnerEvent, report_command_id: Option<String>) -> Result<()>;
    /// Save all pending state and replay only committed events.
    async fn persist(&self) -> Result<()>;
    /// Send a file response outside the numbered outbox after welcome.
    async fn reply(&self, response: RunnerFileResponse) -> Result<()>;
    /// Close the socket without discarding saved state.
    async fn close(&self) -> Result<()>;
}
