//! Controlled repository captures and a recording agent-command owner.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner::emitter::{EventEmitter, SavingEmitter};
use cnd_runner::error::Result;
use cnd_runner::reports::files::{FileReporter, FileReports};
use cnd_runner::reports::handler::{ReportCommandHandler, ReportDependencies};
use cnd_runner::reports::prepare::{ReportFilter, UnfilteredReports};
use cnd_runner::repository::error;
use cnd_runner::repository::service::{Checkpoint, Repository, RepositorySnapshot};
use cnd_runner::runtime::CommandHandler;
use cnd_runner_interface::file_changes::{ChangedFile, ChangesResponse, ChangesResponseSummary};
use cnd_runner_interface::file_tree::{FileEntry, FileEntryKind};
use cnd_runner_interface::files::{DiffResponse, FileResponse};
use cnd_runner_interface::runner_commands::{
    RunnerCommand, RunnerControlCommand, RunnerReportKind, RunnerReportRefresh,
};
use futures_util::future::BoxFuture;
use tokio::sync::{Notify, mpsc};

use crate::support::fixture::{FixedClock, Fixture};

pub(super) struct Source {
    pub current: Mutex<RepositorySnapshot>,
    pub hold: Mutex<Option<Arc<Gate>>>,
}

#[derive(Default)]
pub(super) struct Gate {
    pub arrived: Notify,
    pub release: Notify,
}

#[async_trait]
impl Repository for Source {
    async fn prepare_context(&self) -> error::Result<()> {
        Ok(())
    }
    async fn snapshot(&self, _: String) -> error::Result<RepositorySnapshot> {
        let current = self.current.lock().unwrap().clone();
        let gate = self.hold.lock().unwrap().take();
        if let Some(gate) = gate {
            gate.arrived.notify_one();
            gate.release.notified().await;
        }
        Ok(current)
    }
    async fn changes(&self, _: String) -> error::Result<ChangesResponse> {
        Ok(self.current.lock().unwrap().changes.clone())
    }
    async fn read(&self, _: String, _: u64) -> error::Result<FileResponse> {
        Err(error::Error::NotFound)
    }
    async fn diff(&self, _: String, _: String) -> error::Result<DiffResponse> {
        Err(error::Error::NotFound)
    }
    async fn checkpoint(&self) -> error::Result<Checkpoint> {
        Ok(BTreeMap::new())
    }
    async fn changed_since(&self, _: String, _: Checkpoint) -> error::Result<Vec<ChangedFile>> {
        Ok(vec![])
    }
}

pub(super) struct Next(pub mpsc::UnboundedSender<RunnerCommand>);
#[async_trait]
impl CommandHandler for Next {
    fn connected(&self) -> BoxFuture<'static, Result<()>> {
        Box::pin(async { Ok(()) })
    }
    fn command(&self, command: RunnerCommand) -> Result<()> {
        self.0.send(command).unwrap();
        Ok(())
    }
    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }
}

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
            unpushed_commits: Some(0),
            uncommitted_file_count: Some(0),
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

pub(super) fn source(paths: Vec<String>) -> Arc<Source> {
    Arc::new(Source {
        current: Mutex::new(snapshot(paths)),
        hold: Mutex::new(None),
    })
}

pub(super) async fn files(
    h: &Fixture,
    source: Arc<dyn Repository>,
    emitter: Option<Arc<dyn EventEmitter>>,
    filter: Option<Arc<dyn ReportFilter>>,
) -> Arc<dyn FileReports> {
    Arc::new(FileReporter::new(
        source,
        "main".into(),
        emitter.unwrap_or_else(|| Arc::new(SavingEmitter::new(h.link.clone()))),
        filter.unwrap_or_else(|| Arc::new(UnfilteredReports)),
        h.store.snapshot().await.file_revisions,
    ))
}

pub(super) async fn handler(
    h: &Fixture,
    files: Arc<dyn FileReports>,
) -> (
    Arc<dyn CommandHandler>,
    mpsc::UnboundedReceiver<RunnerCommand>,
) {
    let (send, receive) = mpsc::unbounded_channel();
    let dependencies = ReportDependencies {
        files,
        ports: None,
        emitter: Arc::new(SavingEmitter::new(h.link.clone())),
        link: h.link.clone(),
        store: h.store.clone(),
        clock: Arc::new(FixedClock),
        filter: Arc::new(UnfilteredReports),
        watches: None,
        next: Arc::new(Next(send)),
    };
    (
        Arc::new(ReportCommandHandler::new(
            dependencies,
            h.store.snapshot().await.reports.commands,
        )),
        receive,
    )
}

pub(super) fn refresh(kind: RunnerReportKind, id: &str) -> RunnerCommand {
    RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerReportRefresh(
        RunnerReportRefresh::ReportRefresh {
            command_id: id.into(),
            kind,
        },
    ))
}
