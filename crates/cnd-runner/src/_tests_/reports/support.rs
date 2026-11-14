//! Pure snapshots and mocked repository and emission boundaries.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use cnd_runner_interface::file_changes::{ChangesResponse, ChangesResponseSummary};
use cnd_runner_interface::file_tree::{FileEntry, FileEntryKind};
use cnd_runner_interface::runner::RunnerEvent;
use unimock::{MockFn, Unimock, matching};

use crate::emitter::{EventEmitter, EventEmitterMock};
use crate::reports::files::{FileReporter, FileReports};
use crate::reports::prepare::{ReportFilter, UnfilteredReports};
use crate::repository::service::{Repository, RepositoryMock, RepositorySnapshot};
use crate::state::records::FileRevisions;

pub(super) fn snapshot(paths: Vec<String>) -> RepositorySnapshot {
    RepositorySnapshot {
        entries: paths
            .into_iter()
            .map(|path| FileEntry {
                path,
                display_path: None,
                name: "file".into(),
                kind: FileEntryKind::File,
                change: None,
            })
            .collect(),
        changes: ChangesResponse {
            base_branch: "main".into(),
            display_base_branch: None,
            unpushed_commits: Some(3),
            uncommitted_file_count: Some(4),
            files: vec![],
            summary: ChangesResponseSummary {
                files: 0,
                added: 0,
                removed: 0,
            },
        },
        identities: BTreeMap::new(),
        read_identities: BTreeMap::new(),
        base_commit: "base".into(),
    }
}

type Captured = Arc<Mutex<Vec<(RunnerEvent, Option<String>)>>>;

pub(super) struct Fixture {
    pub files: Arc<dyn FileReports>,
    pub current: Arc<Mutex<Option<RepositorySnapshot>>>,
    pub events: Captured,
}

impl Fixture {
    pub(super) fn new(current: RepositorySnapshot) -> Self {
        Self::with_filter(current, Arc::new(UnfilteredReports))
    }

    pub(super) fn with_filter(current: RepositorySnapshot, filter: Arc<dyn ReportFilter>) -> Self {
        let current = Arc::new(Mutex::new(Some(current)));
        let events = Arc::new(Mutex::new(vec![]));
        let captured = events.clone();
        let source = current.clone();
        let repository: Arc<dyn Repository> = Arc::new(Unimock::new(
            RepositoryMock::snapshot
                .each_call(matching!(_))
                .answers_arc(Arc::new(move |_, _| {
                    source
                        .lock()
                        .unwrap()
                        .clone()
                        .ok_or(crate::repository::error::Error::Unavailable)
                })),
        ));
        let emitter: Arc<dyn EventEmitter> = Arc::new(Unimock::new(
            EventEmitterMock::emit
                .each_call(matching!(_, _))
                .answers_arc(Arc::new(move |_, events, receipt| {
                    captured
                        .lock()
                        .unwrap()
                        .extend(events.into_iter().map(|event| (event, receipt.clone())));
                    Ok(())
                })),
        ));
        let files: Arc<dyn FileReports> = Arc::new(FileReporter::new(
            repository,
            "main".into(),
            emitter,
            filter,
            FileRevisions::default(),
        ));
        Self {
            files,
            current,
            events,
        }
    }

    pub(super) fn take(&self) -> Vec<(RunnerEvent, Option<String>)> {
        std::mem::take(&mut *self.events.lock().unwrap())
    }
}
