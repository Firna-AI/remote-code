//! Compose file commands and report repairs with the existing connection handler.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner_interface::file_tree::RunnerFileEvent;
use cnd_runner_interface::runner::{RunnerEvent, RunnerReady};
use cnd_runner_interface::runner_commands::{
    RunnerCommand, RunnerControlCommand, RunnerReportKind, RunnerReportRefresh,
};
use futures_util::future::BoxFuture;
use tokio::task::JoinHandle;

use crate::clock::Clock;
use crate::emitter::EventEmitter;
use crate::error::{Error, Result};
use crate::link::ports::RunnerLink;
use crate::ports::reporter::PortReports;
use crate::runtime::CommandHandler;
use crate::state::store::EventStore;
use crate::watcher::service::ReportWatches;

use super::files::{FileReportKind, FileReports};
use super::prepare::ReportFilter;

/// Dependencies supplied by the composition root. No agent command is interpreted here.
pub struct ReportDependencies {
    /// File scan and request owner.
    pub files: Arc<dyn FileReports>,
    /// Optional listening-port owner.
    pub ports: Option<Arc<dyn PortReports>>,
    /// Event output policy shared with the turn owner.
    pub emitter: Arc<dyn EventEmitter>,
    /// Saved connection for unnumbered file replies and retained report replay.
    pub link: Arc<dyn RunnerLink>,
    /// Loaded durable event state.
    pub store: Arc<dyn EventStore>,
    /// Event timestamps.
    pub clock: Arc<dyn Clock>,
    /// Complete-source credential filter.
    pub filter: Arc<dyn ReportFilter>,
    /// Native watch and restore-marker owner, when enabled.
    pub watches: Option<Arc<dyn ReportWatches>>,
    /// Agent command and live-turn shutdown owner.
    pub next: Arc<dyn CommandHandler>,
}

/// Report command handler. Work starts synchronously in wire order, then runs independently.
pub struct ReportCommandHandler {
    dependencies: Arc<ReportDependencies>,
    seen: Mutex<BTreeSet<String>>,
    jobs: Mutex<Vec<JoinHandle<()>>>,
    stopped: Arc<AtomicBool>,
}

impl ReportCommandHandler {
    /// Compose after loading state. Pass the saved report IDs to suppress restart repeats.
    pub fn new(dependencies: ReportDependencies, saved_commands: Vec<String>) -> Self {
        Self {
            dependencies: Arc::new(dependencies),
            seen: Mutex::new(saved_commands.into_iter().collect()),
            jobs: Mutex::new(vec![]),
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[async_trait]
impl CommandHandler for ReportCommandHandler {
    async fn start(&self) -> Result<()> {
        self.dependencies.files.start().await?;
        self.dependencies.next.start().await?;
        if let Some(watches) = &self.dependencies.watches {
            watches.start().await?;
        }
        Ok(())
    }

    fn connected(&self) -> BoxFuture<'static, Result<()>> {
        if self.stopped.load(Ordering::Acquire) {
            return Box::pin(async { Ok(()) });
        }
        let welcomed = self.dependencies.next.connected();
        let initial = self.dependencies.files.refresh(true, None, None);
        let dependencies = self.dependencies.clone();
        let stopped = self.stopped.clone();
        Box::pin(async move {
            welcomed.await?;
            if let Some(watches) = &dependencies.watches {
                watches.start().await?;
            }
            if initial.await.is_err() {
                tracing::warn!("The initial file reports could not be saved.");
                dependencies
                    .emitter
                    .emit(
                        vec![RunnerEvent::RunnerFileEvent(
                            RunnerFileEvent::FilesUnavailable {},
                        )],
                        None,
                    )
                    .await?;
            }
            if stopped.load(Ordering::Acquire) {
                return Ok(());
            }
            if let Some(ports) = &dependencies.ports {
                ports.refresh(true, None).await?;
            }
            if stopped.load(Ordering::Acquire) {
                return Ok(());
            }
            dependencies
                .emitter
                .emit(
                    vec![RunnerEvent::RunnerReady(RunnerReady::RunnerReady {})],
                    None,
                )
                .await
        })
    }

    fn command(&self, command: RunnerCommand) -> Result<()> {
        if self.stopped.load(Ordering::Acquire) {
            return Ok(());
        }
        let dependencies = self.dependencies.clone();
        let job = match command {
            RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerFileCommand(
                command,
            )) => tokio::spawn(async move {
                let response = dependencies.files.request(command).await;
                let response = dependencies.filter.response(response);
                let result = match response {
                    Ok(response) => dependencies.link.reply(response).await,
                    Err(error) => Err(error),
                };
                if result.is_err() {
                    tracing::warn!("The runner command could not finish.");
                }
            }),
            RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerReportRefresh(
                RunnerReportRefresh::ReportRefresh { command_id, kind },
            )) => {
                if !self
                    .seen
                    .lock()
                    .or(Err(Error::InvalidCommand))?
                    .insert(command_id.clone())
                {
                    return Ok(());
                }
                let action: BoxFuture<'static, Result<()>> = match kind {
                    RunnerReportKind::FilesSnapshot => dependencies.files.refresh(
                        true,
                        Some(FileReportKind::Tree),
                        Some(command_id),
                    ),
                    RunnerReportKind::ChangesUpdated => dependencies.files.refresh(
                        true,
                        Some(FileReportKind::Changes),
                        Some(command_id),
                    ),
                    RunnerReportKind::PortsUpdated => match &dependencies.ports {
                        Some(ports) => ports.refresh(true, Some(command_id)),
                        None => Box::pin(async { Ok(()) }),
                    },
                    kind => Box::pin(async move {
                        let now = dependencies.clock.now()?;
                        dependencies
                            .store
                            .refresh_report(kind, command_id, now, dependencies.filter.clone())
                            .await?;
                        dependencies.link.persist().await
                    }),
                };
                tokio::spawn(async move {
                    if action.await.is_err() {
                        tracing::warn!("The runner command could not finish.");
                    }
                })
            }
            command => return self.dependencies.next.command(command),
        };
        let mut jobs = self.jobs.lock().or(Err(Error::InvalidCommand))?;
        jobs.retain(|job| !job.is_finished());
        jobs.push(job);
        Ok(())
    }

    async fn shutdown(&self) -> Result<()> {
        self.stopped.store(true, Ordering::Release);
        let watches = async {
            if let Some(watches) = &self.dependencies.watches {
                watches.close().await;
            }
        };
        let turns = self.dependencies.next.shutdown();
        let ports = async {
            if let Some(ports) = &self.dependencies.ports {
                ports.close().await;
            }
        };
        let (turns, _, _) = tokio::join!(turns, ports, watches);
        let jobs = std::mem::take(&mut *self.jobs.lock().or(Err(Error::InvalidCommand))?);
        for job in jobs {
            let _ = job.await;
        }
        turns
    }
}
