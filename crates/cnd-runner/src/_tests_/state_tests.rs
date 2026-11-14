//! Failed-save recovery and durable sequence invariants.

#![allow(clippy::unwrap_used)]

use std::sync::atomic::Ordering;

use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;
use serde_json::json;

use crate::error::Error;
use crate::state::records::RunnerState;
use crate::test_support::{Memory, session, title};

#[tokio::test]
async fn failed_writes_keep_pending_changes_and_later_saves_commit_them() {
    let memory = Memory::default();
    let store = memory.store().await;
    memory.fail.store(true, Ordering::SeqCst);
    assert!(matches!(
        store.append(title("First"), 100, None).await,
        Err(Error::Disconnected)
    ));
    assert_eq!(store.snapshot().await.next_event_number, 1);
    assert_eq!(store.snapshot().await.outbox, vec![]);
    store.remember(session()).await.unwrap();
    store.append(title("Second"), 100, None).await.unwrap();
    let saved = store.snapshot().await;
    assert_eq!(
        saved
            .outbox
            .iter()
            .map(|RunnerEventEnvelope::Event { event_number, .. }| *event_number)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(saved.sessions, vec![session()]);
    memory.fail.store(true, Ordering::SeqCst);
    assert!(matches!(store.confirm(1).await, Err(Error::Disconnected)));
    assert_eq!(store.snapshot().await.confirmed_through, 0);
    store
        .append(title("Third"), 100, Some("report-command".into()))
        .await
        .unwrap();
    let saved = store.snapshot().await;
    assert_eq!(saved.confirmed_through, 1);
    assert_eq!(saved.next_event_number, 4);
    assert_eq!(saved.outbox.len(), 2);
    assert_eq!(saved.reports.commands, vec!["report-command"]);
    assert_eq!(
        saved.reports.latest.title,
        Some(
            cnd_runner_interface::runner::RunnerWorkspaceTitle::WorkspaceTitle {
                name: "Third".into()
            }
        )
    );
    assert_eq!(memory.store().await.snapshot().await, saved);
    assert!(matches!(
        store.confirm(4).await,
        Err(Error::ConfirmationAhead)
    ));
    store.confirm(0).await.unwrap();
    assert_eq!(store.snapshot().await, saved);
}

#[test]
fn reads_old_node_state_and_refuses_broken_sequences_and_unsafe_numbers() {
    let old = json!({ "streamId":"old", "nextEventNumber":1, "confirmedThrough":0, "outbox":[], "sessions":[{"sessionId":"s", "agent":"claude", "providerSessionId":null, "instructions":"fixed"}], "fileRevisions":{"tree":7,"changes":9}, "turns":[] });
    let parsed = RunnerState::decode(&serde_json::to_vec(&old).unwrap()).unwrap();
    assert_eq!(parsed.file_revisions.tree, 7);
    assert_eq!(parsed.sessions[0].instruction_branches, None);
    assert_eq!(parsed.reports.commands, Vec::<String>::new());
    let mut counter = old.clone();
    counter["nextEventNumber"] = json!(2);
    assert!(matches!(
        RunnerState::decode(&serde_json::to_vec(&counter).unwrap()),
        Err(Error::InvalidCounter)
    ));
    for (stream, number) in [("other", 1), ("old", 2)] {
        let mut gap = old.clone();
        gap["nextEventNumber"] = json!(3);
        gap["outbox"] = json!([{"type":"event","streamId":stream,"eventNumber":number,"occurredAt":100,"event":{"type":"runner.ready"}}]);
        assert!(matches!(
            RunnerState::decode(&serde_json::to_vec(&gap).unwrap()),
            Err(Error::InvalidOutbox)
        ));
    }
    for ports in [
        json!([{ "port":0,"name":null,"folder":null }]),
        json!(vec![json!({"port":3000,"name":null,"folder":null}); 65]),
    ] {
        let mut state = old.clone();
        state["nextEventNumber"] = json!(2);
        state["outbox"] = json!([{"type":"event","streamId":"old","eventNumber":1,"occurredAt":100,"event":{"type":"ports.updated","ports":ports}}]);
        assert!(matches!(
            RunnerState::decode(&serde_json::to_vec(&state).unwrap()),
            Err(Error::InvalidPorts)
        ));
    }
    let mut unsafe_state = old;
    unsafe_state["fileRevisions"]["tree"] = json!(9_007_199_254_740_992_u64);
    assert!(matches!(
        RunnerState::decode(&serde_json::to_vec(&unsafe_state).unwrap()),
        Err(Error::InvalidNumber)
    ));
}
