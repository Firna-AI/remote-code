//! Relay failures with typed internal sources.

use internal_error::InternalError;
use thiserror::Error;

/// Relay startup or transport failure.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub enum Error {
    /// No local address accepted the connection.
    #[error("[cnd-relay/connect] the server did not answer")]
    Unavailable,
    /// The inherited socket must be a local listener.
    #[error("[cnd-relay/listener] invalid activation socket")]
    Activation,
    /// An unexpected internal failure.
    #[error("[cnd-relay] internal: {0:?}")]
    Internal(#[from] InternalError),
}

/// Result of a relay operation.
pub type Result<T> = std::result::Result<T, Error>;
