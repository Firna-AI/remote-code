//! A held repository scan permits report repair and agent commands before readiness.

use std::sync::Arc;

use cnd_runner_interface::runner_commands::{
    RunnerCommand, RunnerControlCommand, RunnerInterrupt, RunnerReportKind,
};
use cnd_runner_interface::runner_files::{RunnerFileCommand, RunnerReadFile};
use cnd_runner_interface::runner_handshake::{RunnerEventEnvelope, RunnerToWorkspace};

use crate::support::events::title;
use crate::support::fixture::Fixture;

use super::support::{self, Gate};

#[tokio::test]
async fn handles_retained_report_agent_command_and_file_read_while_initial_scan_waits() {
    let h = Fixture::new().await;
    h.connected().await;
    h.link.emit(title("saved name"), None).await.unwrap();
    let source = support::source(vec![]);
    let gate = Arc::new(Gate::default());
    *source.hold.lock().unwrap() = Some(gate.clone());
    let files = support::files(&h, source, None, None).await;
    let (handler, mut forwarded) = support::handler(&h, files).await;
    let starting = {
        let handler = handler.clone();
        tokio::spawn(async move { handler.connected().await })
    };
    gate.arrived.notified().await;
    handler
        .command(support::refresh(
            RunnerReportKind::WorkspaceTitle,
            "before-ready",
        ))
        .unwrap();
    let interrupt = RunnerCommand::RunnerControlCommand(RunnerControlCommand::RunnerInterrupt(
        RunnerInterrupt::Interrupt {
            command_id: "stop".into(),
            session_id: "session".into(),
            turn_id: "turn".into(),
        },
    ));
    handler.command(interrupt.clone()).unwrap();
    assert_eq!(forwarded.recv().await.unwrap(), interrupt);
    handler
        .command(RunnerCommand::RunnerControlCommand(
            RunnerControlCommand::RunnerFileCommand(RunnerFileCommand::Read(
                RunnerReadFile::Read {
                    request_id: "read".into(),
                    path: "missing".into(),
                    max_bytes: 100,
                },
            )),
        ))
        .unwrap();
    while h.store.snapshot().await.reports.commands.is_empty() {
        tokio::task::yield_now().await;
    }
    assert!(!starting.is_finished());
    let types: Vec<_> = h
        .endpoint
        .state
        .lock()
        .await
        .events
        .iter()
        .map(|RunnerEventEnvelope::Event { event, .. }| {
            serde_json::to_value(event).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    assert_eq!(types, ["workspace.title", "workspace.title"]);
    gate.release.notify_one();
    starting.await.unwrap().unwrap();
    handler.shutdown().await.unwrap();
    assert!(
        h.endpoint
            .state
            .lock()
            .await
            .received
            .iter()
            .any(|message| matches!(message, RunnerToWorkspace::RunnerFileResponse(_)))
    );
    assert_eq!(h.store.snapshot().await.reports.commands, ["before-ready"]);
}

#[tokio::test]
async fn report_commands_keep_scan_order_and_deduplicate_inflight_and_saved_requests() {
    let h = Fixture::new().await;
    h.connected().await;
    let source = support::source(
        (0..6)
            .map(|index| format!("{}{index}", "x".repeat(90_000)))
            .collect(),
    );
    let gate = Arc::new(Gate::default());
    *source.hold.lock().unwrap() = Some(gate.clone());
    let files = support::files(&h, source, None, None).await;
    let (handler, _) = support::handler(&h, files).await;
    handler
        .command(support::refresh(RunnerReportKind::FilesSnapshot, "first"))
        .unwrap();
    gate.arrived.notified().await;
    handler
        .command(support::refresh(RunnerReportKind::FilesSnapshot, "second"))
        .unwrap();
    handler
        .command(support::refresh(RunnerReportKind::FilesSnapshot, "first"))
        .unwrap();
    assert!(h.endpoint.state.lock().await.events.is_empty());
    gate.release.notify_one();
    handler.shutdown().await.unwrap();
    let state = h.store.snapshot().await;
    assert_eq!(state.reports.commands, ["first", "second"]);
    assert_eq!(state.file_revisions.tree, 2);
    assert_eq!(state.file_revisions.changes, 0);
    assert_eq!(state.outbox.len(), 6);
    let parts: Vec<_> = state
        .outbox
        .iter()
        .map(|RunnerEventEnvelope::Event { event, .. }| {
            let value = serde_json::to_value(event).unwrap();
            (
                value["tree"]["revision"].as_u64().unwrap(),
                value["tree"]["partNumber"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(parts, [(1, 1), (1, 2), (1, 3), (2, 1), (2, 2), (2, 3)]);
    let files = support::files(&h, support::source(vec![]), None, None).await;
    let (restarted, _) = support::handler(&h, files).await;
    restarted
        .command(support::refresh(RunnerReportKind::FilesSnapshot, "second"))
        .unwrap();
    restarted.shutdown().await.unwrap();
    assert_eq!(
        h.store.snapshot().await.next_event_number,
        state.next_event_number
    );
}

#[tokio::test]
async fn welcome_reserves_the_initial_scan_before_a_later_request_without_polling() {
    let h = Fixture::new().await;
    h.connected().await;
    let source = support::source(vec!["first".into()]);
    let gate = Arc::new(Gate::default());
    *source.hold.lock().unwrap() = Some(gate.clone());
    let files = support::files(&h, source, None, None).await;
    let (handler, _) = support::handler(&h, files).await;
    let connected = handler.connected();
    handler
        .command(support::refresh(RunnerReportKind::FilesSnapshot, "second"))
        .unwrap();
    gate.arrived.notified().await;
    assert!(h.store.snapshot().await.outbox.is_empty());
    gate.release.notify_one();
    connected.await.unwrap();
    handler.shutdown().await.unwrap();
    let state = h.store.snapshot().await;
    let mut requested = None;
    let mut changes_revision = None;
    for RunnerEventEnvelope::Event { event, .. } in &state.outbox {
        let value = serde_json::to_value(event).unwrap();
        if value["type"] == "files.snapshot" {
            requested = value["tree"]["revision"].as_u64();
        }
        if value["type"] == "changes.updated" {
            changes_revision = requested;
        }
    }
    assert_eq!(changes_revision, Some(1));
    assert_eq!(requested, Some(2));
    assert_eq!(state.reports.commands, ["second"]);
}
