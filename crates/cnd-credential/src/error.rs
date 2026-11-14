//! Credential-safe failures at the command boundary.

use internal_error::InternalError;
use thiserror::Error;

/// A credential request failed. Display never includes transport diagnostics.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub enum Error {
    /// Git needs a current agent turn.
    #[error("Git gets GitHub access in an agent turn. Ask an agent to run this command.")]
    TurnRequired,
    /// The Worker supplied a checked, plain refusal message.
    #[error("{0}")]
    Refused(String),
    /// The credential context or response is invalid.
    #[error("GitHub access failed. Try again.")]
    Invalid,
    /// An unexpected failure, whose details must stay private.
    #[error("GitHub access failed. Try again.")]
    Internal(#[from] InternalError),
}

/// Result of a credential operation.
pub type Result<T> = std::result::Result<T, Error>;
