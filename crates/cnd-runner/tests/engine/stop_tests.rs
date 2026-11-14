//! Stop and shutdown cancel starts, requests, and scans without duplicate ends.

use std::sync::atomic::Ordering;
use std::time::Duration;

use cnd_runner::runtime::CommandHandler;
use cnd_runner_interface::file_changes::{ChangeKind, ChangedFile};
use serde_json::json;

use super::builders::{input_ids, message, stop, turn};
use super::support::{Fixture, TestResult};

#[tokio::test]
async fn keeps_other_sessions_live_during_a_held_start_and_closes_the_canceled_helper() -> TestResult
{
    let h = Fixture::new().await?;
    h.helpers.start_gate.hold();
    h.engine.command(turn("A", "first")?)?;
    h.helpers.start_gate.entered.notified().await;
    let first = h.latest()?;
    h.engine.command(turn("B", "other")?)?;
    h.wait_events(2).await;
    h.engine.command(stop("B", "other", "stop-B")?)?;
    h.wait_events(3).await;
    assert_eq!(serde_json::to_value(h.events().await)?[2]["sessionId"], "B");
    assert!(!first.closed.load(Ordering::SeqCst));
    h.engine.command(stop("A", "first", "stop-A")?)?;
    h.engine.command(stop("A", "first", "again")?)?;
    h.engine.idle().await?;
    assert!(first.closed.load(Ordering::SeqCst));
    assert_eq!(input_ids(&first)?, Vec::<String>::new());
    assert_eq!(h.events().await.len(), 4);
    assert_eq!(
        h.store
            .snapshot()
            .await
            .sessions
            .iter()
            .find(|s| s.session_id == "A")
            .and_then(|s| s.provider_session_id.as_deref()),
        None
    );
    h.close().await
}

#[tokio::test]
async fn stops_before_start_without_a_late_started_event_and_suppresses_redelivery() -> TestResult {
    let h = Fixture::new().await?;
    h.engine.command(turn("session", "pending")?)?;
    h.engine
        .command(stop("session", "pending", "stop-pending")?)?;
    h.engine.idle().await?;
    assert_eq!(
        serde_json::to_value(h.events().await)?,
        json!([{"type":"turn.completed","sessionId":"session","turnId":"pending","state":"stopped","durationMs":0,"files":[],"omittedFileCount":0,"userMessageIds":[]}])
    );
    assert_eq!(
        h.helpers
            .processes
            .lock()
            .map_err(|_| "test lock poisoned")?
            .len(),
        0
    );
    let mut again = turn("session", "pending")?;
    if let cnd_runner_interface::runner_commands::RunnerCommand::RunnerTurn(
        cnd_runner_interface::runner_commands::RunnerTurn::Turn { command_id, .. },
    ) = &mut again
    {
        *command_id = "redelivery".into();
    }
    h.command(again).await?;
    assert_eq!(h.events().await.len(), 1);
    h.close().await
}

#[tokio::test]
async fn cancels_a_held_input_request_and_then_accepts_another_turn() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    let first = h.latest()?;
    first.send_gate.hold();
    h.engine.command(message("session", "first", "held")?)?;
    first.send_gate.entered.notified().await;
    h.engine.command(stop("session", "first", "stop")?)?;
    h.engine.idle().await?;
    assert!(first.closed.load(Ordering::SeqCst));
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["userMessageIds"],
        json!(["message-first", "message-held"])
    );
    h.command(turn("session", "next")?).await?;
    assert_eq!(input_ids(h.latest()?.as_ref())?, ["message-next"]);
    h.close().await
}

#[tokio::test]
async fn cancels_baseline_and_completion_scans_and_reads_stopped_files_again() -> TestResult {
    let h = Fixture::new().await?;
    h.repositories.baseline_gate.hold();
    h.engine.command(turn("session", "baseline")?)?;
    h.repositories.baseline_gate.entered.notified().await;
    h.command(stop("session", "baseline", "stop-baseline")?)
        .await?;
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["state"],
        "stopped"
    );
    assert_eq!(
        h.helpers
            .processes
            .lock()
            .map_err(|_| "test lock poisoned")?
            .len(),
        0
    );
    h.repositories.baseline_gate.release();
    h.command(turn("session", "scan")?).await?;
    h.repositories.files_gate.hold();
    h.latest()?.result(&[]);
    h.repositories.files_gate.entered.notified().await;
    h.engine.command(stop("session", "scan", "stop-scan")?)?;
    h.repositories.files_gate.entered.notified().await;
    let controls = h
        .repositories
        .cancellations
        .lock()
        .map_err(|_| "test lock poisoned")?
        .clone();
    assert!(matches!(
        controls[1].check(),
        Err(cnd_runner::repository::error::Error::Canceled)
    ));
    assert!(controls[3].check().is_ok());
    *h.repositories
        .files
        .lock()
        .map_err(|_| "test lock poisoned")? = vec![ChangedFile {
        path: "changed.txt".into(),
        display_path: None,
        previous_path: None,
        previous_display_path: None,
        change: ChangeKind::Modified,
        added: 2,
        removed: 1,
    }];
    h.repositories.files_gate.release();
    h.engine.idle().await?;
    assert_eq!(
        serde_json::to_value(h.events().await)?[3],
        json!({"type":"turn.completed","sessionId":"session","turnId":"scan","state":"stopped","durationMs":0,"files":[{"path":"changed.txt","change":"modified","added":2,"removed":1}],"omittedFileCount":0,"userMessageIds":["message-scan"]})
    );
    h.close().await
}

#[tokio::test(start_paused = true)]
async fn caps_stopped_file_reads_at_ten_seconds_and_finishes_shutdown() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    h.repositories.files_gate.hold();
    let engine = h.engine.clone();
    let closing = tokio::spawn(async move { engine.shutdown().await });
    h.repositories.files_gate.entered.notified().await;
    h.advance(Duration::from_millis(9999)).await;
    assert!(!closing.is_finished());
    assert_eq!(h.events().await.len(), 1);
    h.advance(Duration::from_millis(1)).await;
    closing.await??;
    assert_eq!(
        serde_json::to_value(h.events().await)?[1],
        json!({"type":"turn.completed","sessionId":"session","turnId":"first","state":"stopped","durationMs":0,"files":[],"filesUnavailable":true,"omittedFileCount":0,"userMessageIds":["message-first"]})
    );
    h.engine.command(turn("session", "closed")?)?;
    assert_eq!(h.events().await.len(), 2);
    Ok(())
}

#[tokio::test]
async fn waits_for_a_handoff_helper_close_before_stop_or_shutdown_ends() -> TestResult {
    for shutdown in [false, true] {
        let h = Fixture::new().await?;
        h.command(turn("session", "first")?).await?;
        let first = h.latest()?;
        first.deferred.store(true, Ordering::SeqCst);
        h.command(message("session", "first", "deferred")?).await?;
        first.close_gate.hold();
        first.result(&[]);
        first.close_gate.entered.notified().await;
        h.engine.command(stop("session", "first", "stop")?)?;
        let engine = h.engine.clone();
        let ending = tokio::spawn(async move {
            if shutdown {
                engine.shutdown().await
            } else {
                engine.idle().await
            }
        });
        first.close_gate.entered.notified().await;
        assert!(!ending.is_finished());
        assert_eq!(h.events().await.len(), 1);
        first.close_gate.release();
        ending.await??;
        assert!(first.closed.load(Ordering::SeqCst));
        assert_eq!(
            h.helpers
                .processes
                .lock()
                .map_err(|_| "test lock poisoned")?
                .len(),
            1
        );
        assert_eq!(
            serde_json::to_value(h.events().await)?[1]["state"],
            "stopped"
        );
        h.close().await?;
    }
    Ok(())
}

#[tokio::test]
async fn ends_once_with_unavailable_files_after_normal_and_stopped_scan_failures() -> TestResult {
    for shutdown in [false, true] {
        let h = Fixture::new().await?;
        h.command(turn("session", "first")?).await?;
        h.repositories.fail_files.store(true, Ordering::SeqCst);
        if shutdown {
            h.close().await?;
        } else {
            h.latest()?.result(&[]);
            h.engine.idle().await?;
        }
        assert_eq!(
            serde_json::to_value(h.events().await)?[1],
            json!({"type":"turn.completed","sessionId":"session","turnId":"first","state":if shutdown {"stopped"} else {"finished"},"durationMs":0,"files":[],"filesUnavailable":true,"omittedFileCount":0,"userMessageIds":["message-first"]})
        );
        assert!(h.latest()?.closed.load(Ordering::SeqCst));
        h.close().await?;
    }
    Ok(())
}
