//! Update failures with a stable typed boundary.

use internal_error::InternalError;
use thiserror::Error;

/// An update could not finish safely.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub enum Error {
    /// Another background check owns the download lock. Installation checks wait.
    #[error("[cnd-cli/update] another update check is running. Try again later.")]
    Busy,
    /// Releases and parts require a valid digest.
    #[error("[cnd-cli/update] missing or invalid digest")]
    MissingDigest,
    /// A downloaded part does not match its digest.
    #[error("[cnd-cli/update] digest mismatch for {name}")]
    DigestMismatch {
        /// Name of the refused part.
        name: String,
    },
    /// The new executable or root installer failed.
    #[error("[cnd-cli/update] start or install check failed")]
    StartFailed,
    /// A release does not contain the required parts or identity.
    #[error("[cnd-cli/update] invalid release")]
    InvalidRelease,
    /// There is no previous release to restore.
    #[error("[cnd-cli/update] failed first start has no previous release")]
    NoPrevious,
    /// An unexpected dependency failure.
    #[error("[cnd-cli/update] internal: {0:?}")]
    Internal(#[from] InternalError),
}

/// Result of a sandbox update operation.
pub type Result<T> = std::result::Result<T, Error>;
