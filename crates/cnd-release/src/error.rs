//! Release input errors and the internal failure boundary.

use std::result;

use internal_error::InternalError;
use thiserror::Error;

/// A release cannot be built or read.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub enum Error {
    /// A release lacks a role that its own program needs.
    #[error("[cnd-release] missing release part: {name}")]
    MissingPart {
        /// The absent role.
        name: String,
    },
    /// Release versions must use the commit-count version rule.
    #[error("[cnd-release] invalid release version: {version}")]
    InvalidVersion {
        /// The rejected version.
        version: String,
    },
    /// A parts file uses an unsupported format.
    #[error("[cnd-release] unsupported parts schema: {version}")]
    UnsupportedSchema {
        /// The unknown schema version.
        version: u32,
    },
    /// A part has no valid name, absolute HTTPS URL, or SHA-256 digest.
    #[error("[cnd-release] invalid or duplicate part: {name}")]
    InvalidPart {
        /// The rejected part name.
        name: String,
    },
    /// A build must supply both embedding variables or neither variable.
    #[error("[cnd-release] set CONDUCTIVE_RELEASE_VERSION and CONDUCTIVE_PARTS_FILE together")]
    IncompleteEmbedding,
    /// The current metadata must name this program and target.
    #[error("[cnd-release] metadata does not name the Conductive Linux musl release")]
    InvalidMetadata,
    /// An unexpected filesystem, archive, or serialization failure.
    #[error("[cnd-release] internal: {0:?}")]
    Internal(#[from] InternalError),
}

/// Result of building or reading release files.
pub type Result<T> = result::Result<T, Error>;
