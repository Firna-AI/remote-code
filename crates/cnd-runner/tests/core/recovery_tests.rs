//! Turn records, receipts, and restart recovery without an agent process.

use std::sync::atomic::Ordering;

use cnd_runner::error::Error;
use cnd_runner_interface::chat_events::{AgentChatEvent, AgentChatEventTurnCompletedState};
use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;

use crate::support::events::{accepted, ended, number, started};
use crate::support::fixture::{self, Fixture};

#[tokio::test]
async fn commits_turn_records_with_their_envelopes_and_keeps_the_first_pending_end() {
    let h = Fixture::new().await;
    h.store.accept_turn(accepted("turn")).await.unwrap();
    h.disk.hold.store(true, Ordering::SeqCst);
    let store = h.store.clone();
    let starting = tokio::spawn(async move { store.append(started("turn"), 100, None).await });
    h.disk.arrived.notified().await;
    assert_eq!(h.store.snapshot().await.turns, vec![accepted("turn")]);
    assert_eq!(h.store.snapshot().await.outbox, vec![]);
    h.disk.release.notify_one();
    starting.await.unwrap().unwrap();
    let mut record = accepted("turn");
    record.start_event_number = Some(1);
    assert_eq!(h.store.snapshot().await.turns, vec![record.clone()]);
    h.store.confirm(1).await.unwrap();
    assert_eq!(h.store.snapshot().await.turns, vec![record.clone()]);
    h.disk.fail.store(true, Ordering::SeqCst);
    assert!(matches!(
        h.store.append(ended("turn"), 100, None).await,
        Err(Error::Disconnected)
    ));
    assert_eq!(h.store.snapshot().await.turns, vec![record.clone()]);
    let envelope = h
        .store
        .append(ended("turn"), 200, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(number(&envelope), 2);
    record.end_event_number = Some(2);
    assert_eq!(h.store.snapshot().await.turns, vec![record]);
    assert_eq!(h.store.snapshot().await.next_event_number, 3);
    let RunnerEventEnvelope::Event { occurred_at, .. } = envelope;
    assert_eq!(occurred_at.0, 100);
    h.store.confirm(2).await.unwrap();
    assert_eq!(h.store.snapshot().await.turns, vec![]);
    h.store.append(started("failed"), 100, None).await.unwrap();
    let failure = serde_json::from_value(serde_json::json!({"type":"turn.failed","sessionId":"session","turnId":"failed","error":{"code":"provider_failed","message":"The provider failed."},"retryMessageId":"message-failed","durationMs":0})).unwrap();
    let failed = h.store.append(failure, 100, None).await.unwrap();
    assert_eq!(
        h.store.append(ended("failed"), 200, None).await.unwrap(),
        failed
    );
    let mut record = accepted("failed");
    record.start_event_number = Some(3);
    record.end_event_number = Some(4);
    assert_eq!(h.store.snapshot().await.turns, vec![record]);
    h.store.confirm(4).await.unwrap();
    assert_eq!(h.store.snapshot().await.turns, vec![]);
}

#[tokio::test]
async fn restart_stops_unfinished_turns_once_and_replays_saved_ends_unchanged() {
    let h = Fixture::new().await;
    h.store
        .append(started("finished"), 100, None)
        .await
        .unwrap();
    h.store.append(ended("finished"), 100, None).await.unwrap();
    h.store.append(started("cutoff"), 100, None).await.unwrap();
    h.store.accept_turn(accepted("pending")).await.unwrap();
    h.store
        .remember_report_command("answered".into())
        .await
        .unwrap();
    let before = h.store.snapshot().await;
    let reopened = fixture::open(h.disk.clone()).await;
    assert_eq!(reopened.snapshot().await, before);
    reopened.recover(400).await.unwrap();
    let saved = reopened.snapshot().await;
    assert_eq!(&saved.outbox[..3], &before.outbox);
    assert_eq!(
        saved.outbox.iter().map(number).collect::<Vec<_>>(),
        vec![1, 2, 3, 4, 5]
    );
    let endings: Vec<_> = saved
        .outbox
        .iter()
        .filter_map(|RunnerEventEnvelope::Event { event, .. }| match event {
            RunnerEvent::AgentChatEvent(AgentChatEvent::TurnCompleted {
                turn_event_context,
                state,
                duration_ms,
                files,
                files_unavailable,
                omitted_file_count,
                user_message_ids,
                ..
            }) => Some((
                turn_event_context.turn_id.clone(),
                state.clone(),
                *duration_ms,
                files.len(),
                files_unavailable.is_some(),
                *omitted_file_count,
                user_message_ids.clone(),
            )),
            _ => None,
        })
        .collect();
    assert_eq!(
        endings,
        vec![
            (
                "finished".into(),
                AgentChatEventTurnCompletedState::Stopped,
                0,
                0,
                false,
                0,
                vec!["message-finished".into()]
            ),
            (
                "cutoff".into(),
                AgentChatEventTurnCompletedState::Stopped,
                300,
                0,
                true,
                0,
                vec!["message-cutoff".into()]
            ),
            (
                "pending".into(),
                AgentChatEventTurnCompletedState::Stopped,
                300,
                0,
                false,
                0,
                vec!["message-pending".into()]
            ),
        ]
    );
    reopened.recover(500).await.unwrap();
    assert_eq!(reopened.snapshot().await, saved);
    assert_eq!(saved.reports.commands, vec!["answered"]);
    reopened.confirm(5).await.unwrap();
    assert_eq!(reopened.snapshot().await.turns, vec![]);
}
