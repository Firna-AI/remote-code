//! Compose the full unprivileged runner and graceful signal shutdown.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use cnd_cli::update::staging::NODE_PART;
use cnd_runner::clock::SystemClock;
use cnd_runner::config::Configuration;
use cnd_runner::disk::AtomicDisk;
use cnd_runner::emitter::{EventEmitter, SavingEmitter};
use cnd_runner::engine::dependencies::{EngineDependencies, GitTurnRepositories, TurnRepositories};
use cnd_runner::engine::handler::AgentEngine;
use cnd_runner::filter::service::{CredentialFilter, Credentials, FilteredEmitter};
use cnd_runner::helper::process::NodeHelpers;
use cnd_runner::helper::startup::RunnerStartup;
use cnd_runner::link::connection::SavedRunnerLink;
use cnd_runner::ports::proc::{DiskProcReader, ProcPortScanner};
use cnd_runner::ports::reporter::{PortReporter, PortReports};
use cnd_runner::reports::files::FileReporter;
use cnd_runner::reports::handler::{ReportCommandHandler, ReportDependencies};
use cnd_runner::repository::git::{Cancellation, ChildGit};
use cnd_runner::repository::io::LocalRepositoryIo;
use cnd_runner::runtime::{Runner, RunnerCore};
use cnd_runner::socket::WebSocketConnector;
use cnd_runner::state::store::{DurableStore, EventStore};
use cnd_runner::watcher::linux::LinuxWatchDriver;
use cnd_runner::watcher::service::ReportWatchService;
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::watch;
use uuid::Uuid;

use crate::error::{ErrorResultExt, Result};

/// Role containing the SDK helper and its runtime packages.
pub(crate) const SDK_HELPER_PART: &str = "sdk-helper";

pub(crate) async fn execute() -> Result<()> {
    let environment: BTreeMap<String, String> = std::env::vars().collect();
    let cwd = std::env::current_dir().internal()?;
    let home = environment
        .get("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/home/user"));
    let configuration = Configuration::parse(&environment, &cwd, &home).internal()?;
    let executable = std::env::current_exe()
        .internal()?
        .canonicalize()
        .internal()?;
    let release = executable.parent().unwrap_or(&cwd);
    let development = release
        .file_name()
        .is_some_and(|name| name == "debug" || name == "release");
    let node = environment
        .get("CONDUCTIVE_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if development {
                PathBuf::from("node")
            } else {
                release.join(NODE_PART).join("bin/node")
            }
        });
    let program = environment
        .get("CONDUCTIVE_SDK_HELPER")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if development {
                cwd.join("dist/sdk-helper/sdk-helper.mjs")
            } else {
                release.join(SDK_HELPER_PART).join("sdk-helper.mjs")
            }
        });
    let helpers = Arc::new(NodeHelpers { node, program });
    let clock = Arc::new(SystemClock);
    let store: Arc<dyn EventStore> = Arc::new(DurableStore::new(
        Arc::new(AtomicDisk::new(configuration.state_path.clone())),
        Uuid::new_v4().to_string(),
    ));
    store.load().await.internal()?;
    let loaded = store.snapshot().await;
    let link = Arc::new(SavedRunnerLink::new(
        configuration.workspace_id.clone(),
        configuration.request.clone(),
        Arc::new(WebSocketConnector),
        clock.clone(),
        store.clone(),
    ));
    let filter = Arc::new(CredentialFilter::default());
    filter
        .add(configuration.request.workspace_token.clone())
        .internal()?;
    let saving: Arc<dyn EventEmitter> = Arc::new(SavingEmitter::new(link.clone()));
    let chat: Arc<dyn EventEmitter> =
        Arc::new(FilteredEmitter::new(filter.clone(), saving.clone()));
    let repositories = Arc::new(GitTurnRepositories {
        root: configuration.cwd.clone(),
        git: Arc::new(ChildGit),
        io: Arc::new(LocalRepositoryIo),
    });
    let files = Arc::new(FileReporter::new(
        repositories.open(Cancellation::default()),
        configuration.default_branch.clone(),
        saving.clone(),
        filter.clone(),
        loaded.file_revisions.clone(),
    ));
    let ports: Arc<dyn PortReports> = Arc::new(PortReporter::new(
        Arc::new(ProcPortScanner::new(
            Arc::new(DiskProcReader),
            rustix::process::getuid().as_raw(),
            configuration.home.clone(),
            configuration.cwd.clone(),
        )),
        saving.clone(),
        filter.clone(),
    ));
    let watches = Arc::new(ReportWatchService::new(
        Arc::new(LinuxWatchDriver),
        files.clone(),
        Some(ports.clone()),
        configuration.cwd.clone(),
        PathBuf::from("/run/conductive-terminal/restore-ended"),
    ));
    let startup = Arc::new(RunnerStartup {
        home: configuration.home.clone(),
        helpers: helpers.clone(),
        executable,
    });
    let engine = Arc::new(AgentEngine::new(
        EngineDependencies {
            configuration,
            store: store.clone(),
            emitter: chat,
            credentials: filter.clone(),
            helpers,
            repositories,
            clock: clock.clone(),
            startup,
            background_limit: Duration::from_secs(30 * 24 * 60 * 60),
        },
        loaded.clone(),
    ));
    let handler = Arc::new(ReportCommandHandler::new(
        ReportDependencies {
            files,
            ports: Some(ports),
            emitter: saving,
            link: link.clone(),
            store: store.clone(),
            clock: clock.clone(),
            filter,
            watches: Some(watches),
            next: engine,
        },
        loaded.reports.commands,
    ));
    let runner: Arc<dyn Runner> = Arc::new(RunnerCore::new(link, store, clock, handler));
    let (stop, shutdown) = watch::channel(false);
    let mut terminate = signal(SignalKind::terminate()).internal()?;
    let mut interrupt = signal(SignalKind::interrupt()).internal()?;
    let signals = tokio::spawn(async move {
        tokio::select! { _ = terminate.recv() => {}, _ = interrupt.recv() => {} }
        stop.send_replace(true);
    });
    let result = runner.run(shutdown).await.internal();
    signals.abort();
    let _ = signals.await;
    result
}
