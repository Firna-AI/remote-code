//! Errors returned by the command boundary.

use std::result;

use internal_error::InternalError;
use thiserror::Error;

use crate::command::Command;

/// A failure to execute a Conductive command.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub(crate) enum Error {
    /// The selected command has no implementation yet.
    #[error("[cnd-cli/command] {command} is not available yet")]
    NotAvailable {
        /// The unavailable command family.
        command: Command,
    },
    /// An unexpected internal failure.
    #[error("[cnd-cli/command] internal: {0:?}")]
    Internal(#[from] InternalError),
}

/// Result of executing a command.
pub(crate) type Result<T> = result::Result<T, Error>;
