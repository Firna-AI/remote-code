//! Retained reports choose the newest pending state and save answer receipts atomically.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use cnd_runner::reports::prepare::UnfilteredReports;
use cnd_runner_interface::api::Timestamp;
use cnd_runner_interface::runner::{RunnerEvent, RunnerStartUpdated};
use cnd_runner_interface::runner_commands::RunnerReportKind;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;
use cnd_runner_interface::workspaces::{WorkspaceStart, WorkspaceStartKind};

use crate::support::events::title;
use crate::support::fixture::{self, Fixture};

#[tokio::test]
async fn refresh_selects_newest_pending_report_after_a_held_save_and_keeps_receipts_after_restart()
{
    let h = Fixture::new().await;
    h.store.append(title("old"), 100, None).await.unwrap();
    h.store.confirm(1).await.unwrap();
    h.disk.hold.store(true, Ordering::SeqCst);
    let store = h.store.clone();
    let normal = tokio::spawn(async move { store.append(title("new"), 100, None).await });
    h.disk.arrived.notified().await;
    let store = h.store.clone();
    let refresh = tokio::spawn(async move {
        store
            .refresh_report(
                RunnerReportKind::WorkspaceTitle,
                "newest".into(),
                101,
                Arc::new(UnfilteredReports),
            )
            .await
    });
    assert_eq!(
        h.store.snapshot().await.reports.latest.title,
        Some(match title("old") {
            RunnerEvent::RunnerWorkspaceTitle(title) => title,
            _ => unreachable!(),
        })
    );
    h.disk.release.notify_one();
    normal.await.unwrap().unwrap();
    refresh.await.unwrap().unwrap();
    let state = h.store.snapshot().await;
    assert_eq!(state.reports.commands, ["newest"]);
    assert!(
        matches!(state.outbox.last(), Some(RunnerEventEnvelope::Event { event, event_number: 3, .. }) if *event == title("new"))
    );
    h.store.confirm(3).await.unwrap();
    let reopened = fixture::open(h.disk.clone()).await;
    reopened
        .refresh_report(
            RunnerReportKind::WorkspaceTitle,
            "newest".into(),
            200,
            Arc::new(UnfilteredReports),
        )
        .await
        .unwrap();
    assert_eq!(reopened.snapshot().await.next_event_number, 4);
    reopened
        .refresh_report(
            RunnerReportKind::StartUpdated,
            "no-start".into(),
            200,
            Arc::new(UnfilteredReports),
        )
        .await
        .unwrap();
    assert_eq!(reopened.snapshot().await.next_event_number, 4);
    assert_eq!(
        reopened.snapshot().await.reports.commands,
        ["newest", "no-start"]
    );
    let start = RunnerEvent::RunnerStartUpdated(RunnerStartUpdated::StartUpdated {
        start: WorkspaceStart {
            kind: WorkspaceStartKind::Resume,
            started_at: Timestamp(200),
            steps: vec![],
        },
    });
    reopened.append(start.clone(), 200, None).await.unwrap();
    reopened.confirm(4).await.unwrap();
    reopened
        .refresh_report(
            RunnerReportKind::StartUpdated,
            "with-start".into(),
            201,
            Arc::new(UnfilteredReports),
        )
        .await
        .unwrap();
    assert!(
        matches!(reopened.snapshot().await.outbox.last(), Some(RunnerEventEnvelope::Event { event, event_number: 5, .. }) if *event == start)
    );
}

#[tokio::test]
async fn failed_refresh_save_keeps_a_pending_receipt_and_later_persist_exposes_one_answer() {
    let h = Fixture::new().await;
    h.store.append(title("saved"), 100, None).await.unwrap();
    h.disk.fail.store(true, Ordering::SeqCst);
    assert!(
        h.store
            .refresh_report(
                RunnerReportKind::WorkspaceTitle,
                "repair".into(),
                100,
                Arc::new(UnfilteredReports)
            )
            .await
            .is_err()
    );
    assert_eq!(h.store.snapshot().await.next_event_number, 2);
    h.store.persist().await.unwrap();
    h.store
        .refresh_report(
            RunnerReportKind::WorkspaceTitle,
            "repair".into(),
            100,
            Arc::new(UnfilteredReports),
        )
        .await
        .unwrap();
    assert_eq!(h.store.snapshot().await.next_event_number, 3);
    assert_eq!(h.store.snapshot().await.reports.commands, ["repair"]);
}
