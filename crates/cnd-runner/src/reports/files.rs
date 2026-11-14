//! Serialized file scans, durable revisions, and independent file responses.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::file_changes::RunnerChangesPart;
use cnd_runner_interface::file_tree::{RunnerFileEvent, RunnerFileRevisionPart};
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_files::{
    DiffReadOutcome, FileReadOutcome, RunnerDiffResult, RunnerFileCommand, RunnerFileResponse,
    RunnerFileResult, RunnerReadDiff, RunnerReadFile,
};
use cnd_runner_interface::wire::{WireFalse, WireTrue};
use futures_util::future::BoxFuture;
use tokio::sync::Mutex;

use crate::emitter::EventEmitter;
use crate::error::Result;
use crate::repository::service::{Repository, RepositorySnapshot};
use crate::state::records::FileRevisions;

use super::parts::split;
use super::prepare::ReportFilter;
use super::queue::SerialQueue;
use super::updates::{changes_updated, tree_update};

/// Select only one kind for a report request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileReportKind {
    /// Full tree.
    Tree,
    /// Full changes list.
    Changes,
}

/// Scan service shared by connection, requests, and repository watches.
#[cfg_attr(test, unimock::unimock(api = FileReportsMock))]
#[async_trait]
pub trait FileReports: Send + Sync {
    /// Prepare context storage. A failure warns without blocking startup.
    async fn start(&self) -> Result<()>;
    /// Serialize with earlier scans and emit captured parts in order.
    fn refresh(
        &self,
        full: bool,
        kind: Option<FileReportKind>,
        command_id: Option<String>,
    ) -> BoxFuture<'static, Result<()>>;
    /// File reads and diffs bypass the scan queue.
    async fn request(&self, command: RunnerFileCommand) -> RunnerFileResponse;
}

struct History {
    revisions: FileRevisions,
    tree: Option<RepositorySnapshot>,
    changes: Option<RepositorySnapshot>,
    unavailable: bool,
}

/// Reporter with separate last-tree and last-changes comparisons.
#[derive(Clone)]
pub struct FileReporter {
    repository: Arc<dyn Repository>,
    branch: String,
    emitter: Arc<dyn EventEmitter>,
    filter: Arc<dyn ReportFilter>,
    history: Arc<Mutex<History>>,
    queue: Arc<SerialQueue>,
}

impl FileReporter {
    /// Compose a reporter with revisions from the loaded durable state.
    pub fn new(
        repository: Arc<dyn Repository>,
        branch: String,
        emitter: Arc<dyn EventEmitter>,
        filter: Arc<dyn ReportFilter>,
        revisions: FileRevisions,
    ) -> Self {
        Self {
            repository,
            branch,
            emitter,
            filter,
            history: Arc::new(Mutex::new(History {
                revisions,
                tree: None,
                changes: None,
                unavailable: false,
            })),
            queue: Arc::new(SerialQueue::default()),
        }
    }

    async fn scan(
        &self,
        state: &mut History,
        full: bool,
        kind: Option<FileReportKind>,
        command_id: Option<String>,
    ) -> Result<()> {
        let current = match self.repository.snapshot(self.branch.clone()).await {
            Ok(current) => current,
            Err(_) => {
                state.unavailable = true;
                tracing::warn!("The file tree could not be read.");
                return self
                    .emitter
                    .emit(
                        vec![RunnerEvent::RunnerFileEvent(
                            RunnerFileEvent::FilesUnavailable {},
                        )],
                        command_id,
                    )
                    .await;
            }
        };
        let mut events = vec![];
        if kind != Some(FileReportKind::Changes)
            && let Some(event) = tree_update(
                state.tree.as_ref(),
                &current,
                state.revisions.tree + 1,
                full || state.unavailable,
            )
        {
            events.push(event);
        }
        if kind != Some(FileReportKind::Tree)
            && (full || changes_updated(state.changes.as_ref(), &current))
        {
            events.push(RunnerFileEvent::ChangesUpdated {
                changes: RunnerChangesPart {
                    changes_response: current.changes.clone(),
                    runner_file_revision_part: RunnerFileRevisionPart {
                        revision: state.revisions.changes + 1,
                        part_number: 1,
                        part_count: 1,
                    },
                },
            });
        }
        for event in events {
            let Some(parts) = split(self.filter.file_report(event)?)? else {
                tracing::warn!("The file report contains an entry that exceeds its byte limit.");
                return Ok(());
            };
            let total = parts.len();
            for (index, part) in parts.into_iter().enumerate() {
                match &part {
                    RunnerFileEvent::FilesSnapshot { tree } => {
                        state.revisions.tree = tree.part.revision
                    }
                    RunnerFileEvent::FilesChanged { delta } => {
                        state.revisions.tree = delta.revision
                    }
                    RunnerFileEvent::ChangesUpdated { changes } => {
                        state.revisions.changes = changes.runner_file_revision_part.revision
                    }
                    _ => {}
                }
                self.emitter
                    .emit(
                        vec![RunnerEvent::RunnerFileEvent(part)],
                        if index + 1 == total {
                            command_id.clone()
                        } else {
                            None
                        },
                    )
                    .await?;
            }
        }
        if kind != Some(FileReportKind::Changes) {
            state.tree = Some(current.clone());
            state.unavailable = false;
        }
        if kind != Some(FileReportKind::Tree) {
            state.changes = Some(current);
        }
        Ok(())
    }
}

#[async_trait]
impl FileReports for FileReporter {
    async fn start(&self) -> Result<()> {
        if self.repository.prepare_context().await.is_err() {
            tracing::warn!("The context folder could not be prepared. The runner will continue.");
        }
        Ok(())
    }

    fn refresh(
        &self,
        full: bool,
        kind: Option<FileReportKind>,
        command_id: Option<String>,
    ) -> BoxFuture<'static, Result<()>> {
        let reporter = self.clone();
        self.queue.run(async move {
            let mut state = reporter.history.lock().await;
            let result = reporter.scan(&mut state, full, kind, command_id).await;
            if result.is_err() {
                state.unavailable = true;
            }
            result
        })
    }

    async fn request(&self, command: RunnerFileCommand) -> RunnerFileResponse {
        match command {
            RunnerFileCommand::Read(RunnerReadFile::Read {
                request_id,
                path,
                max_bytes,
            }) => {
                let result = match self.repository.read(path, max_bytes).await {
                    Ok(file) => FileReadOutcome::Success { ok: WireTrue, file },
                    Err(error) => FileReadOutcome::Failure {
                        ok: WireFalse,
                        error: error.file_error(),
                    },
                };
                RunnerFileResponse::File(RunnerFileResult::Read { request_id, result })
            }
            RunnerFileCommand::Diff(RunnerReadDiff::Diff {
                request_id,
                path,
                default_branch,
            }) => {
                let result = match self.repository.diff(path, default_branch).await {
                    Ok(diff) => DiffReadOutcome::Success { ok: WireTrue, diff },
                    Err(error) => DiffReadOutcome::Failure {
                        ok: WireFalse,
                        error: error.file_error(),
                    },
                };
                RunnerFileResponse::Diff(RunnerDiffResult::Diff { request_id, result })
            }
        }
    }
}

#[cfg(test)]
#[path = "../_tests_/reports/mod.rs"]
mod reports_tests;
