//! Native watches cover new directories, index writes, and a live folder after restore.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use cnd_runner::emitter::EventEmitter;
use cnd_runner::error::Result;
use cnd_runner::reports::files::{FileReporter, FileReports};
use cnd_runner::reports::prepare::UnfilteredReports;
use cnd_runner::state::records::FileRevisions;
use cnd_runner::watcher::boundary::{RepositoryWatch, WatchDriver};
use cnd_runner::watcher::linux::LinuxWatchDriver;
use cnd_runner::watcher::service::{ReportWatchService, ReportWatches};
use cnd_runner_interface::file_changes::ChangeKind;
use cnd_runner_interface::file_tree::RunnerFileEvent;
use cnd_runner_interface::runner::RunnerEvent;
use tokio::sync::mpsc;

use super::support::Fixture;

struct Events(mpsc::UnboundedSender<RunnerEvent>);
#[async_trait]
impl EventEmitter for Events {
    async fn emit(&self, events: Vec<RunnerEvent>, _: Option<String>) -> Result<()> {
        for event in events {
            self.0.send(event).unwrap();
        }
        Ok(())
    }
}

struct TrackingDriver(mpsc::UnboundedSender<PathBuf>);
#[async_trait]
impl WatchDriver for TrackingDriver {
    async fn open(&self, root: PathBuf) -> Result<Arc<dyn RepositoryWatch>> {
        let watcher = LinuxWatchDriver.open(root.clone()).await?;
        self.0.send(root).unwrap();
        Ok(watcher)
    }
    async fn exists(&self, marker: PathBuf) -> bool {
        LinuxWatchDriver.exists(marker).await
    }
    async fn delay(&self, duration: Duration) {
        LinuxWatchDriver.delay(duration).await;
    }
}

async fn changed(events: &mut mpsc::UnboundedReceiver<RunnerEvent>, path: &str, kind: ChangeKind) {
    tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = events.recv().await {
            if let RunnerEvent::RunnerFileEvent(RunnerFileEvent::ChangesUpdated { changes }) = event
                && changes
                    .changes_response
                    .files
                    .iter()
                    .any(|file| file.changed_file.path == path && file.changed_file.change == kind)
            {
                return;
            }
        }
        panic!("report channel closed");
    })
    .await
    .expect("watch report hang guard");
}

#[tokio::test]
async fn watches_new_directory_and_index_and_reopens_the_live_repository_after_restore() {
    let h = Fixture::new().await;
    let (send, mut events) = mpsc::unbounded_channel();
    let files: Arc<dyn FileReports> = Arc::new(FileReporter::new(
        h.repository.clone(),
        "main".into(),
        Arc::new(Events(send)),
        Arc::new(UnfilteredReports),
        FileRevisions::default(),
    ));
    files.refresh(true, None, None).await.unwrap();
    let (opened, mut roots) = mpsc::unbounded_channel();
    let marker = h.root.parent().unwrap().join("runtime/restore-ended");
    let watches: Arc<dyn ReportWatches> = Arc::new(ReportWatchService::new(
        Arc::new(TrackingDriver(opened)),
        files.clone(),
        None,
        h.root.clone(),
        marker.clone(),
    ));
    watches.start().await.unwrap();
    assert_eq!(roots.recv().await.unwrap(), h.root);
    h.write("created/deep/new.txt", b"new\n");
    changed(&mut events, "created/deep/new.txt", ChangeKind::Untracked).await;
    h.git(&["add", "created/deep/new.txt"]);
    changed(&mut events, "created/deep/new.txt", ChangeKind::Added).await;
    let retired = h.root.parent().unwrap().join("retired");
    std::fs::rename(&h.root, &retired).unwrap();
    assert!(
        Command::new("git")
            .args(["clone", "--no-hardlinks"])
            .arg(&retired)
            .arg(&h.root)
            .output()
            .unwrap()
            .status
            .success()
    );
    std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
    std::fs::write(&marker, "").unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(30), roots.recv())
            .await
            .unwrap()
            .unwrap(),
        h.root
    );
    h.write("after-restore.txt", b"restored\n");
    changed(&mut events, "after-restore.txt", ChangeKind::Untracked).await;
    watches.close().await;
    assert!(roots.try_recv().is_err());
}
