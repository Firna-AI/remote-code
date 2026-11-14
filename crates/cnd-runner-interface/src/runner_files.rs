//! File commands and matching results. These results stay outside the chat event log.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::files::{DiffResponse, FileResponse};
use crate::wire::{WireFalse, WireTrue};

/// A file read or diff command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum RunnerFileCommand {
    /// Read file content.
    Read(RunnerReadFile),
    /// Read a branch diff.
    Diff(RunnerReadDiff),
}

/// A file content request. The backend sets the read limit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerReadFile {
    /// Read repository file bytes.
    #[serde(rename = "file.read")]
    Read {
        /// Request identity.
        request_id: String,
        /// Real repository path.
        path: String,
        /// Maximum bytes the backend permits.
        #[ts(type = "number")]
        max_bytes: u64,
    },
}

/// A branch diff request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerReadDiff {
    /// Read repository file changes.
    #[serde(rename = "file.diff")]
    Diff {
        /// Request identity.
        request_id: String,
        /// Real repository path.
        path: String,
        /// Diff base branch.
        default_branch: String,
    },
}

/// A failed file or diff read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "code", rename_all_fields = "camelCase")]
pub enum RunnerFileError {
    /// The path does not exist.
    #[serde(rename = "file_not_found")]
    NotFound {
        /// Public error text.
        message: String,
    },
    /// The file cannot be read.
    #[serde(rename = "file_unavailable")]
    Unavailable {
        /// Public error text.
        message: String,
    },
    /// The file exceeds the requested limit.
    #[serde(rename = "file_too_large")]
    TooLarge {
        /// Public error text.
        message: String,
        /// Actual file bytes.
        #[ts(type = "number")]
        size_bytes: u64,
        /// Requested maximum bytes.
        #[ts(type = "number")]
        limit_bytes: u64,
    },
}

/// A file content result with a literal boolean discriminator.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum FileReadOutcome {
    /// Read succeeded.
    Success {
        /// Always true.
        ok: WireTrue,
        /// Complete file response.
        file: FileResponse,
    },
    /// Read failed.
    Failure {
        /// Always false.
        ok: WireFalse,
        /// Public file error.
        error: RunnerFileError,
    },
}

/// A diff result with a literal boolean discriminator.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum DiffReadOutcome {
    /// Read succeeded.
    Success {
        /// Always true.
        ok: WireTrue,
        /// Complete diff response.
        diff: DiffResponse,
    },
    /// Read failed.
    Failure {
        /// Always false.
        ok: WireFalse,
        /// Public file error.
        error: RunnerFileError,
    },
}

/// File response with its request identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerFileResult {
    /// Response to a content request.
    #[serde(rename = "file.read.result")]
    Read {
        /// Request identity.
        request_id: String,
        /// Read outcome.
        result: FileReadOutcome,
    },
}

/// Diff response with its request identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerDiffResult {
    /// Response to a diff request.
    #[serde(rename = "file.diff.result")]
    Diff {
        /// Request identity.
        request_id: String,
        /// Read outcome.
        result: DiffReadOutcome,
    },
}

/// File requests are commands. Their results do not enter the chat event log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum RunnerFileResponse {
    /// Content result.
    File(RunnerFileResult),
    /// Diff result.
    Diff(RunnerDiffResult),
}
