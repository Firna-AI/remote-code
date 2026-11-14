//! Typed tool failures and credential-safe terminal messages.

use internal_error::InternalError;
use thiserror::Error;

/// A tool failed before a valid reply was available.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub enum Error {
    /// Invalid local input.
    #[error("[cnd-tools/input] {0}")]
    Input(InputError),
    /// The Worker refused the request.
    #[error("[cnd-tools/http] {code}: {message}")]
    Worker {
        /// Worker HTTP status.
        status: u16,
        /// Public refusal code with the credential removed.
        code: String,
        /// Public refusal message with the credential removed.
        message: String,
    },
    /// The HTTP request did not finish.
    #[error("[cnd-tools/http] request failed")]
    Network {
        /// Whether the request concerns a Mac command.
        mac: bool,
    },
    /// The response did not satisfy the tool contract.
    #[error("[cnd-tools/http] invalid reply")]
    Reply {
        /// Whether the reply concerns a Mac command.
        mac: bool,
    },
    /// A server without an error payload refused the request.
    #[error("[cnd-tools/http] status {status}")]
    Status {
        /// Whether the request concerns a Mac command.
        mac: bool,
        /// HTTP status of the refusal.
        status: u16,
    },
    /// An unexpected implementation failure.
    #[error("[cnd-tools/internal] {0:?}")]
    Internal(#[from] InternalError),
}

impl Error {
    /// Return only the documented public message, with no transport diagnostics.
    pub fn message(&self) -> String {
        match self {
            Self::Input(value) => value.to_string(),
            Self::Worker { code, message, .. } => format!("{code}: {message}"),
            Self::Network { mac } => format!("The {} request failed. Try again.", subject(*mac)),
            Self::Reply { mac } => format!("The {} reply is not valid. Try again.", subject(*mac)),
            Self::Status { status: 401, .. } => {
                "The workspace login is not valid. Start the workspace again.".into()
            }
            Self::Status { mac, .. } => format!(
                "The {} request failed. Check its fields and try again.",
                subject(*mac)
            ),
            Self::Internal(_) => "The workspace request failed. Try again.".into(),
        }
    }
}

fn subject(mac: bool) -> &'static str {
    if mac { "Mac" } else { "workspace" }
}

/// A checked user input error.
#[derive(Debug, Clone, Copy, Error)]
pub enum InputError {
    /// Start the workspace before you use its tools.
    #[error("Start the workspace before you use its tools.")]
    Credentials,
    /// The workspace tools need a valid machine address.
    #[error("The workspace tools need a valid machine address.")]
    Address,
    /// Use an object for the workspace request.
    #[error("Use an object for the workspace request.")]
    Object,
    /// Complete the required workspace fields.
    #[error("Complete the required workspace fields.")]
    Required,
    /// Choose Claude or Codex for the workspace.
    #[error("Choose Claude or Codex for the workspace.")]
    Agent,
    /// Choose a valid effort for the workspace.
    #[error("Choose a valid effort for the workspace.")]
    Effort,
    /// Choose true or false for fast mode.
    #[error("Choose true or false for fast mode.")]
    Fast,
    /// Use a nonempty request ID.
    #[error("Use a nonempty request ID.")]
    RequestId,
    /// Use a whole, nonnegative transcript position.
    #[error("Use a whole, nonnegative transcript position.")]
    Position,
    /// Choose concise or full transcript detail.
    #[error("Choose concise or full transcript detail.")]
    Detail,
    /// Check the list options. Use --help for details.
    #[error("Check the list options. Use --help for details.")]
    List,
    /// Choose true or false for archived workspaces.
    #[error("Choose true or false for archived workspaces.")]
    Archived,
    /// Use text for the workspace name filter.
    #[error("Use text for the workspace name filter.")]
    Query,
    /// The workspace state is not valid.
    #[error("The workspace state is not valid.")]
    State,
    /// Choose whether to stop the running turn.
    #[error("Choose whether to stop the running turn.")]
    Close,
    /// Choose a port number for the preview.
    #[error("Choose a port number for the preview.")]
    Port,
    /// Check the command options. Use --help for details.
    #[error("Check the command options. Use --help for details.")]
    Command,
    /// Check the session options. Use --help for details.
    #[error("Check the session options. Use --help for details.")]
    SessionOptions,
    /// Choose a command. Use --help for details.
    #[error("Choose a command. Use --help for details.")]
    Unknown,
    /// Choose one of the workspace commands.
    #[error("Use workspaces list, get, create, rename, move, or archive.")]
    WorkspaceCommand,
    /// Choose one of the session commands.
    #[error("Use sessions list, get, read, create, send, rename, close, or stop.")]
    SessionCommand,
    /// Supply a Mac command, folder, and reason.
    #[error("Use mac run with a command, folder, and reason.")]
    MacCommand,
    /// Use --message or --message-file for one message.
    #[error("Use --message or --message-file for one message.")]
    MessageConflict,
    /// The message file could not be read. Check its path and try again.
    #[error("The message file could not be read. Check its path and try again.")]
    MessageFile,
    /// The message could not be read from stdin. Try again.
    #[error("The message could not be read from stdin. Try again.")]
    MessageStdin,
    /// Start this request from an active agent turn.
    #[error("Start this request from an active agent turn.")]
    ActiveTurn,
    /// Complete the Mac request fields.
    #[error("Complete the Mac request fields.")]
    MacFields,
    /// Send a valid Mac request number.
    #[error("Send a valid Mac request number.")]
    MacNumber,
    /// Choose a time limit from 1 to 1800 seconds.
    #[error("Choose a time limit from 1 to 1800 seconds.")]
    MacTimeout,
    /// Give a reason for a time limit above 120 seconds.
    #[error("Give a reason for a time limit above 120 seconds.")]
    MacReason,
}

/// A workspace tool result.
pub type Result<T> = std::result::Result<T, Error>;
