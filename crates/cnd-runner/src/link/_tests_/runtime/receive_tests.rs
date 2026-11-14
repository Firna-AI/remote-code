//! Explicit socket and report barriers reproduce cancellation after receipt.

use std::sync::atomic::Ordering;

use cnd_runner_interface::runner_handshake::{RunnerResend, WorkspaceToRunner};
use futures_util::poll;

use super::support::{Fixture, interrupt, welcome};

#[tokio::test]
async fn delivers_both_commands_when_reports_finish_during_post_receipt_wait()
-> Result<(), Box<dyn std::error::Error>> {
    let mut h = Fixture::new(false).await?;
    h.input.send(welcome())?;
    let mut running = Box::pin(h.core.run(h.shutdown));
    assert!(poll!(&mut running).is_pending());
    {
        let _connection = h.link.connection.lock().await;
        h.input
            .send(WorkspaceToRunner::RunnerCommand(Box::new(interrupt(
                "first",
            ))))?;
        assert!(poll!(&mut running).is_pending());
        h.reports_release.notify_one();
        h.reports_done.notified().await;
        assert!(poll!(&mut running).is_pending());
    }
    h.input
        .send(WorkspaceToRunner::RunnerCommand(Box::new(interrupt(
            "second",
        ))))?;
    running.await?;
    let mut delivered = Vec::new();
    while let Ok(command) = h.commands.try_recv() {
        delivered.push(command);
    }
    assert_eq!(delivered, vec![interrupt("first"), interrupt("second")]);
    Ok(())
}

#[tokio::test]
async fn releases_a_parked_send_before_a_failed_report_closes_the_socket()
-> Result<(), Box<dyn std::error::Error>> {
    let mut h = Fixture::new(true).await?;
    h.input.send(welcome())?;
    let mut running = Box::pin(h.core.run(h.shutdown));
    assert!(poll!(&mut running).is_pending());
    h.input
        .send(WorkspaceToRunner::RunnerCommand(Box::new(interrupt(
            "before-resend",
        ))))?;
    h.hold_sends.store(true, Ordering::SeqCst);
    h.input
        .send(WorkspaceToRunner::RunnerResend(RunnerResend::Resend {
            stream_id: "stream".into(),
            from_event_number: 1,
        }))?;
    assert!(poll!(&mut running).is_pending());
    h.sending.notified().await;
    h.reports_release.notify_one();
    h.reports_done.notified().await;
    running.await?;
    assert_eq!(h.commands.try_recv()?, interrupt("before-resend"));
    Ok(())
}
