//! Handshake, replay, gaps, confirmations, and committed-only sends.

use std::sync::atomic::Ordering;

use cnd_runner::error::Error;
use cnd_runner::link::ports::LinkUpdate;
use cnd_runner_interface::runner_handshake::{RunnerConfirm, RunnerResend, WorkspaceToRunner};
use serde_json::json;

use crate::support::events::{number, title};
use crate::support::fixture::{self, Fixture};

#[tokio::test]
async fn retains_events_across_gaps_wrong_confirms_reconnect_and_restart() {
    let h = Fixture::new().await;
    h.endpoint.state.lock().await.drop_next = true;
    h.connected().await;
    assert_eq!(
        serde_json::to_value(&h.endpoint.state.lock().await.received[0]).unwrap(),
        json!({"type":"hello","protocolVersion":2,"workspaceId":"workspace","streamId":"stream","loginKinds":[{"agent":"claude","kind":"token"},{"agent":"claude","kind":"api-key"},{"agent":"codex","kind":"token"},{"agent":"codex","kind":"api-key"}]})
    );
    h.link.emit(title("First"), None).await.unwrap();
    h.link.emit(title("Second"), None).await.unwrap();
    assert_eq!(h.link.step().await.unwrap(), LinkUpdate::Progress);
    assert_eq!(
        h.endpoint
            .state
            .lock()
            .await
            .events
            .iter()
            .map(number)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    h.endpoint
        .inject(WorkspaceToRunner::RunnerConfirm(RunnerConfirm::Confirm {
            stream_id: "other".into(),
            through_event_number: 2,
        }))
        .await;
    h.link.step().await.unwrap();
    assert_eq!(h.store.snapshot().await.outbox.len(), 2);
    h.endpoint
        .inject(WorkspaceToRunner::RunnerConfirm(RunnerConfirm::Confirm {
            stream_id: "stream".into(),
            through_event_number: 1,
        }))
        .await;
    h.link.step().await.unwrap();
    assert_eq!(
        h.store
            .snapshot()
            .await
            .outbox
            .iter()
            .map(number)
            .collect::<Vec<_>>(),
        vec![2]
    );
    h.endpoint.disconnect().await;
    assert_eq!(h.link.step().await.unwrap(), LinkUpdate::Disconnected);
    h.link.emit(title("Offline"), None).await.unwrap();
    let offline = h.store.snapshot().await.outbox[1].clone();
    let store = fixture::open(h.disk.clone()).await;
    let restarted = fixture::link(store.clone(), h.endpoint.clone());
    restarted.connect().await.unwrap();
    assert_eq!(restarted.step().await.unwrap(), LinkUpdate::Connected);
    assert_eq!(h.endpoint.state.lock().await.events[2], offline);
    assert_eq!(store.snapshot().await.next_event_number, 4);
    h.endpoint.state.lock().await.confirm = true;
    h.endpoint
        .inject(WorkspaceToRunner::RunnerResend(RunnerResend::Resend {
            stream_id: "stream".into(),
            from_event_number: 3,
        }))
        .await;
    restarted.step().await.unwrap();
    restarted.step().await.unwrap();
    assert_eq!(store.snapshot().await.outbox, vec![]);
    assert_eq!(
        h.endpoint
            .state
            .lock()
            .await
            .events
            .iter()
            .map(number)
            .collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    restarted.close().await.unwrap();
}

#[tokio::test]
async fn resends_only_committed_events_while_an_append_write_waits() {
    let h = Fixture::new().await;
    h.endpoint.state.lock().await.drop_next = true;
    h.connected().await;
    h.link.emit(serde_json::from_value(json!({"type":"files.snapshot","tree":{"revision":1,"partNumber":1,"partCount":1,"entries":[]}})).unwrap(), None).await.unwrap();
    h.link.emit(title("two"), None).await.unwrap();
    h.disk.hold.store(true, Ordering::SeqCst);
    let link = h.link.clone();
    let writing = tokio::spawn(async move {
        link.emit(serde_json::from_value(json!({"type":"changes.updated","changes":{"revision":1,"partNumber":1,"partCount":1,"baseBranch":"main","files":[],"summary":{"files":0,"added":0,"removed":0}}})).unwrap(), None).await
    });
    h.disk.arrived.notified().await;
    h.link.step().await.unwrap();
    assert_eq!(
        h.endpoint
            .state
            .lock()
            .await
            .events
            .iter()
            .map(number)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    let saved = h.store.snapshot().await;
    assert_eq!(saved.next_event_number, 3);
    assert_eq!(
        (saved.file_revisions.tree, saved.file_revisions.changes),
        (1, 0)
    );
    h.disk.release.notify_one();
    writing.await.unwrap().unwrap();
    assert_eq!(
        h.endpoint
            .state
            .lock()
            .await
            .events
            .iter()
            .map(number)
            .collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert_eq!(h.store.snapshot().await.file_revisions.changes, 1);
    h.link.close().await.unwrap();
}

#[tokio::test]
async fn refuses_invalid_welcomes_and_keeps_commands_behind_the_handshake() {
    for (stream, through, welcome_first, expected) in [
        ("other", 0, false, "welcome"),
        ("stream", 1, false, "ahead"),
        ("stream", 0, true, "welcome"),
    ] {
        let h = Fixture::new().await;
        h.endpoint.state.lock().await.welcome = welcome_first;
        h.link.connect().await.unwrap();
        if welcome_first {
            h.link.step().await.unwrap();
        }
        h.endpoint.raw(serde_json::to_vec(&json!({"type":"welcome","protocolVersion":2,"streamId":stream,"confirmedThrough":through})).unwrap()).await;
        let error = h.link.step().await.unwrap_err();
        let actual = match error {
            Error::InvalidWelcome => "welcome",
            Error::ConfirmationAhead => "ahead",
            _ => "other",
        };
        assert_eq!(actual, expected);
        assert_eq!(h.link.step().await.unwrap(), LinkUpdate::Disconnected);
    }
    let h = Fixture::new().await;
    h.endpoint.state.lock().await.welcome = false;
    h.link.connect().await.unwrap();
    h.link.emit(title("before welcome"), None).await.unwrap();
    assert_eq!(h.endpoint.state.lock().await.events.len(), 0);
    let interrupt =
        br#"{"type":"interrupt","commandId":"stop","sessionId":"s","turnId":"t"}"#.to_vec();
    h.endpoint.raw(interrupt.clone()).await;
    assert_eq!(h.link.step().await.unwrap(), LinkUpdate::Progress);
    h.endpoint
        .raw(
            br#"{"type":"welcome","protocolVersion":2,"streamId":"stream","confirmedThrough":0}"#
                .to_vec(),
        )
        .await;
    assert_eq!(h.link.step().await.unwrap(), LinkUpdate::Connected);
    assert_eq!(h.endpoint.state.lock().await.events.len(), 1);
    h.endpoint.raw(interrupt.clone()).await;
    let LinkUpdate::Command(command) = h.link.step().await.unwrap() else {
        panic!("command missing");
    };
    assert_eq!(serde_json::to_vec(&command).unwrap(), interrupt);
    h.link.close().await.unwrap();
}
