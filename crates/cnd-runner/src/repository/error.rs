//! Typed repository failures and their public file-response forms.

use cnd_runner_interface::runner_files::RunnerFileError;
use internal_error::InternalError;
use thiserror::Error;

/// Failures that file callers and repository cancellation handle.
#[derive(Debug, Error, internal_error::ErrorContract)]
pub enum Error {
    /// The file is absent.
    #[error("[cnd-runner/files] the file does not exist")]
    NotFound,
    /// The path or file kind cannot be read safely.
    #[error("[cnd-runner/files] the file cannot be read")]
    Unavailable,
    /// A file version or generated patch exceeds its byte budget.
    #[error("[cnd-runner/files] {size} bytes exceed the {limit} byte limit")]
    TooLarge {
        /// Observed file size, or the first patch byte beyond the limit.
        size: u64,
        /// Effective byte budget.
        limit: u64,
    },
    /// A canceled operation must not continue or use a fallback.
    #[error("[cnd-runner/git] the repository command was canceled")]
    Canceled,
    /// Git's exit code permits optional config and symbolic-ref reads.
    #[error("[cnd-runner/git] the repository command exited with {code:?}")]
    Command {
        /// Exit code, absent for a signal.
        code: Option<i32>,
    },
    /// Git returned malformed records.
    #[error("[cnd-runner/git] the repository output is invalid")]
    InvalidOutput,
    /// Unhandled IO and external failures retain their source.
    #[error("[cnd-runner/repository] internal: {0:?}")]
    Internal(#[from] InternalError),
}

impl Error {
    /// Public error details without subprocess or host information.
    pub fn file_error(&self) -> RunnerFileError {
        match self {
            Self::NotFound => RunnerFileError::NotFound {
                message: "The file does not exist.".into(),
            },
            Self::TooLarge { size, limit } => RunnerFileError::TooLarge {
                message: "The file exceeds the read limit.".into(),
                size_bytes: *size,
                limit_bytes: *limit,
            },
            _ => RunnerFileError::Unavailable {
                message: "The file cannot be read.".into(),
            },
        }
    }
}

/// Result at a repository boundary.
pub type Result<T> = std::result::Result<T, Error>;
