//! FileTree wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::file_changes::{ChangeKind, RunnerChangesPart};
use crate::wire::{ReadonlyVec, WireTrue};

/// Each payload obeys FILE_EVENT_MAX_BYTES. Its complete runner envelope also
/// obeys RUNNER_EVENT_MAX_BYTES.
/// Tree deltas follow the last applied tree revision, increasing by exactly 1.
/// A split update uses several bounded deltas with consecutive revisions.
/// Changes report revisions increase by 1 for each new full changes report.
/// A full report has a newer revision than the last applied report of its kind.
/// A full report can skip unapplied revisions to recover missing or refused data.
/// Missing parts and revision gaps must never produce a partial full report.
/// Browser file responses and FileEvent retain their complete-report meaning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerFileEvent {
    /// files.snapshot.
    #[serde(rename = "files.snapshot")]
    FilesSnapshot {
        /// tree.
        tree: RunnerFileTreePart,
    },
    /// files.unavailable.
    #[serde(rename = "files.unavailable")]
    FilesUnavailable {},
    /// files.changed.
    #[serde(rename = "files.changed")]
    FilesChanged {
        /// delta.
        delta: FileTreeDelta,
    },
    /// changes.updated.
    #[serde(rename = "changes.updated")]
    ChangesUpdated {
        /// changes.
        changes: RunnerChangesPart,
    },
}

/// Concatenate entries in part order. Each path occurs once in the full tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RunnerFileTreePart {
    /// Part identity and complete report revision.
    #[serde(flatten)]
    pub part: RunnerFileRevisionPart,
    /// The last scan failed. Entries retain the last complete tree, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unavailable: Option<WireTrue>,
    /// Full flat list of paths relative to the repository root.
    #[ts(as = "ReadonlyVec<FileEntry>")]
    pub entries: Vec<FileEntry>,
}

/// The last scan failed. Entries retain the last complete tree, if any.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeResponse {
    /// revision.
    #[ts(type = "number")]
    pub revision: u64,
    /// The last scan failed. Entries retain the last complete tree, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unavailable: Option<WireTrue>,
    /// A full, flat list. Each path is relative to the repository root.
    #[ts(as = "ReadonlyVec<FileEntry>")]
    pub entries: Vec<FileEntry>,
}

/// FileEntryKind wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum FileEntryKind {
    /// file.
    #[serde(rename = "file")]
    File,
    /// directory.
    #[serde(rename = "directory")]
    Directory,
}

/// FileEntry wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// path.
    pub path: String,
    /// displayPath.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display_path: Option<String>,
    /// name.
    pub name: String,
    /// kind.
    pub kind: FileEntryKind,
    /// change.
    pub change: Option<ChangeKind>,
}

/// Revisions and part numbers are positive safe integers, scoped to a stream.
/// Tree reports and changes reports have independent revision sequences.
/// A new stream starts each sequence at 1 with a full report.
/// Reconnects keep the stream, revisions, and pending parts.
/// Parts run from 1 through partCount, in order, with one fixed partCount.
/// A single or empty report uses partNumber 1 and partCount 1.
/// Capture one consistent state. Do not interleave revisions of one report kind.
/// Apply a full report atomically only after every part has been stored.
/// Deduplicate by stream and runner event number before joining parts.
/// An identical repeated part never counts twice. A conflicting part is invalid.
/// Keep the last complete report while parts are pending or a part is refused.
/// Discard an incomplete report after a refusal or the start of a newer report.
/// Never join parts from different streams, report kinds, or revisions.
/// A new stream discards the old stream's incomplete reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RunnerFileRevisionPart {
    /// revision.
    #[ts(type = "number")]
    pub revision: u64,
    /// partNumber.
    #[ts(type = "number")]
    pub part_number: u64,
    /// partCount.
    #[ts(type = "number")]
    pub part_count: u64,
}

/// The next tree revision. Split large updates into consecutive revisions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeDelta {
    /// The next tree revision. Split large updates into consecutive revisions.
    #[ts(type = "number")]
    pub revision: u64,
    /// At most FILE_TREE_DELTA_MAX_CHANGES, also within FILE_EVENT_MAX_BYTES.
    /// An upsert of an unchanged entry reports a content change for that path.
    #[ts(as = "ReadonlyVec<FileTreeChange>")]
    pub changes: Vec<FileTreeChange>,
}

/// FileTreeChange wire variants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "operation", rename_all_fields = "camelCase")]
pub enum FileTreeChange {
    /// upsert.
    #[serde(rename = "upsert")]
    Upsert {
        /// entry.
        entry: FileEntry,
    },
    /// remove.
    #[serde(rename = "remove")]
    Remove {
        /// path.
        path: String,
    },
    /// move.
    #[serde(rename = "move")]
    Move {
        /// previousPath.
        previous_path: String,
        /// entry.
        entry: FileEntry,
    },
}

/// Shared file event max bytes.
pub const FILE_EVENT_MAX_BYTES: u64 = 262_144;

/// Shared file tree delta max changes.
pub const FILE_TREE_DELTA_MAX_CHANGES: u64 = 512;
