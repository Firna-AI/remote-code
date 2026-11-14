//! File revisions and complete private port labels survive outbox replay and restart.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner::emitter::{EventEmitter, SavingEmitter};
use cnd_runner::error::Result;
use cnd_runner::ports::reporter::{PortReporter, PortReports, PortScanner};
use cnd_runner::reports::files::FileReportKind;
use cnd_runner::reports::prepare::UnfilteredReports;
use cnd_runner_interface::ports::{ListeningPort, RunnerPortsUpdated};
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;

use crate::support::fixture::{self, Fixture};

use super::support;

struct Scanner(Vec<ListeningPort>);
#[async_trait]
impl PortScanner for Scanner {
    async fn scan(&self) -> Result<Vec<ListeningPort>> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn keeps_independent_revisions_through_full_refresh_reconnect_and_reopened_store() {
    let h = Fixture::new().await;
    h.connected().await;
    let source = support::source(vec![]);
    let files = support::files(&h, source.clone(), None, None).await;
    files.refresh(true, None, None).await.unwrap();
    *source.current.lock().unwrap() = support::snapshot(vec!["one".into()]);
    files.refresh(false, None, None).await.unwrap();
    files.refresh(true, None, None).await.unwrap();
    h.link.close().await.unwrap();
    h.connected().await;
    files.refresh(true, None, None).await.unwrap();
    let store = fixture::open(h.disk.clone()).await;
    assert_eq!(store.snapshot().await.file_revisions.tree, 4);
    assert_eq!(store.snapshot().await.file_revisions.changes, 3);
    assert_eq!(store.snapshot().await.stream_id, "stream");
    let files = support::files(&h, source, None, None).await;
    files
        .refresh(true, Some(FileReportKind::Tree), Some("restart".into()))
        .await
        .unwrap();
    let saved = h.store.snapshot().await;
    assert_eq!(
        (saved.file_revisions.tree, saved.file_revisions.changes),
        (5, 3)
    );
    assert_eq!(saved.reports.commands, ["restart"]);
}

#[tokio::test]
async fn preserves_complete_port_labels_through_saved_replay_and_whole_label_budgeting() {
    let h = Fixture::new().await;
    h.connected().await;
    let emitter: Arc<dyn EventEmitter> = Arc::new(SavingEmitter::new(h.link.clone()));
    let long = format!("secretpass/{}", "z".repeat(115));
    let server = ListeningPort {
        port: 3000,
        name: Some("development-server-entry-point secretpass".into()),
        folder: Some(long),
    };
    let ports: Arc<dyn PortReports> = Arc::new(PortReporter::new(
        Arc::new(Scanner(vec![server.clone()])),
        emitter.clone(),
        Arc::new(UnfilteredReports),
    ));
    ports.refresh(true, None).await.unwrap();
    h.link.close().await.unwrap();
    ports.refresh(true, Some("repair".into())).await.unwrap();
    let store = fixture::open(h.disk.clone()).await;
    assert_eq!(store.snapshot().await.reports.commands, ["repair"]);
    let expected = RunnerEvent::RunnerPortsUpdated(RunnerPortsUpdated::PortsUpdated {
        ports: vec![server],
    });
    assert!(
        matches!(store.snapshot().await.outbox.last(), Some(RunnerEventEnvelope::Event { event, .. }) if *event == expected)
    );
    h.connected().await;
    assert!(
        h.endpoint
            .state
            .lock()
            .await
            .events
            .iter()
            .any(|RunnerEventEnvelope::Event { event, .. }| event == &expected)
    );
    let oversized = RunnerEvent::RunnerPortsUpdated(RunnerPortsUpdated::PortsUpdated {
        ports: vec![ListeningPort {
            port: 3001,
            name: Some("x".repeat(600_000)),
            folder: Some("safe/app".into()),
        }],
    });
    emitter.emit(vec![oversized], None).await.unwrap();
    assert!(
        matches!(h.store.snapshot().await.outbox.last(), Some(RunnerEventEnvelope::Event { event: RunnerEvent::RunnerPortsUpdated(RunnerPortsUpdated::PortsUpdated { ports }), .. }) if ports[0].name.is_none() && ports[0].folder.as_deref() == Some("safe/app"))
    );
    ports.close().await;
}
