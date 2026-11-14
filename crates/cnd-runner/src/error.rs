//! Stable failures at the runner's storage and transport boundaries.

use internal_error::InternalError;
use thiserror::Error;

/// A runner operation could not finish.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub enum Error {
    /// A required service variable is absent or empty.
    #[error("[cnd-runner/config] set {name} before the runner starts")]
    MissingSetting {
        /// Variable that the caller must supply.
        name: &'static str,
    },
    /// The service accepts secure WebSocket endpoints only.
    #[error("[cnd-runner/socket] the runner endpoint needs TLS")]
    TlsRequired,
    /// Saved events must form one contiguous stream.
    #[error("[cnd-runner/state] the saved runner outbox is not contiguous")]
    InvalidOutbox,
    /// The next number must follow the last saved event.
    #[error("[cnd-runner/state] the saved counter does not match its outbox")]
    InvalidCounter,
    /// A field cannot be represented safely by the workspace's JavaScript runtime.
    #[error("[cnd-runner/json] expected a non-negative safe integer")]
    InvalidNumber,
    /// A confirmation cannot cover an event that has not been numbered.
    #[error("[cnd-runner/state] the confirmation exceeds the runner counter")]
    ConfirmationAhead,
    /// A welcome must match this stream and occur once per connection.
    #[error("[cnd-runner/link] the welcome does not match the runner stream")]
    InvalidWelcome,
    /// A command's session and agent must match its message and credential.
    #[error("[cnd-runner/json] the command context does not match its message")]
    InvalidCommand,
    /// A saved port list exceeds the protocol's range or count.
    #[error("[cnd-runner/state] the saved listening ports exceed their limits")]
    InvalidPorts,
    /// The runner has no active socket.
    #[error("[cnd-runner/link] the runner is disconnected")]
    Disconnected,
    /// A helper request reported a typed provider failure.
    #[error("[cnd-runner/helper] {message}")]
    Agent {
        /// Stable provider code.
        code: String,
        /// Displayable provider cause, filtered before output.
        message: String,
    },
    /// The helper exited before a pending request completed.
    #[error("[cnd-runner/helper] The SDK helper process ended.")]
    HelperExited,
    /// The helper returned malformed framing or a missing model result.
    #[error("[cnd-runner/helper] The SDK helper returned an invalid response.")]
    HelperResponse,
    /// A live operation was canceled by Stop or shutdown.
    #[error("[cnd-runner/turn] The turn was stopped.")]
    Canceled,
    /// The sandbox could not confirm its connected release.
    #[error("[cnd-runner/startup] The connected runner release could not be confirmed.")]
    ReleaseConfirmation,
    /// A turn's initial repository state could not be read.
    #[error("[cnd-runner/turn] The repository could not be read before the agent started.")]
    Checkpoint,
    /// IO, serialization, and external dependency failures retain their source.
    #[error("[cnd-runner] internal: {0:?}")]
    Internal(#[from] InternalError),
}

/// Result of a runner operation.
pub type Result<T> = std::result::Result<T, Error>;
