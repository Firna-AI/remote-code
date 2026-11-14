//! Exact complete-envelope limits and durable refusal confirmations.

use cnd_runner::json::codec;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;

use crate::support::events::{number, title};
use crate::support::fixture::{self, Fixture};

#[tokio::test]
async fn counts_the_complete_escaped_envelope_and_leaves_no_number_gap() {
    let h = Fixture::new().await;
    h.connected().await;
    let budget = 1_048_576 - 114;
    let name = "\n".repeat(budget / 2) + if budget % 2 == 1 { "a" } else { "" };
    h.link.emit(title(&name), None).await.unwrap();
    h.link.emit(title(&(name + "a")), None).await.unwrap();
    h.link.emit(title("after"), None).await.unwrap();
    let state = h.endpoint.state.lock().await;
    assert_eq!(
        state.events.iter().map(number).collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(codec::encode(&state.events[0]).unwrap().len(), 1_048_576);
    let RunnerEventEnvelope::Event { event, .. } = &state.events[1];
    assert_eq!(*event, title("after"));
    assert_eq!(h.store.snapshot().await.outbox, state.events);
    assert_eq!(h.store.snapshot().await.next_event_number, 3);
}

#[tokio::test]
async fn replays_identical_saved_parts_and_removes_confirmed_refusals() {
    let h = Fixture::new().await;
    h.connected().await;
    h.endpoint.state.lock().await.drop_next = true;
    for part in [1, 2] {
        h.link.emit(serde_json::from_value(serde_json::json!({"type":"files.snapshot","tree":{"revision":7,"partNumber":part,"partCount":2,"entries":[{"path":format!("file-{part}"),"name":"file","kind":"file","change":null}]}})).unwrap(), None).await.unwrap();
    }
    let pending = h.store.snapshot().await.outbox;
    assert_eq!(h.endpoint.state.lock().await.events, vec![]);
    h.link.close().await.unwrap();
    let store = fixture::open(h.disk.clone()).await;
    let link = fixture::link(store.clone(), h.endpoint.clone());
    link.connect().await.unwrap();
    link.step().await.unwrap();
    assert_eq!(h.endpoint.state.lock().await.events, pending);
    assert_eq!(store.snapshot().await.file_revisions.tree, 7);
    {
        let mut endpoint = h.endpoint.state.lock().await;
        endpoint.confirm = true;
        endpoint.refuse.insert(3);
    }
    link.emit(title("refused"), None).await.unwrap();
    link.step().await.unwrap();
    assert_eq!(store.snapshot().await.outbox, vec![]);
    assert_eq!(h.endpoint.state.lock().await.refusals, vec![3]);
    link.close().await.unwrap();
    link.connect().await.unwrap();
    link.step().await.unwrap();
    assert_eq!(h.endpoint.state.lock().await.refusals, vec![3]);
    link.close().await.unwrap();
}

#[tokio::test]
async fn rejects_large_file_payloads_without_advancing_revisions_or_report_receipts() {
    let h = Fixture::new().await;
    let event = serde_json::from_value(serde_json::json!({"type":"files.snapshot","tree":{"revision":1,"partNumber":1,"partCount":1,"entries":[{"path":"\n".repeat(131_072),"name":"file","kind":"file","change":null}]}})).unwrap();
    assert_eq!(
        h.store
            .append(event, 100, Some("oversized".into()))
            .await
            .unwrap(),
        None
    );
    let saved = h.store.snapshot().await;
    assert_eq!(saved.next_event_number, 1);
    assert_eq!(saved.file_revisions.tree, 0);
    assert_eq!(saved.reports.commands, Vec::<String>::new());
    h.store.append(title("after"), 100, None).await.unwrap();
    assert_eq!(h.store.snapshot().await.next_event_number, 2);
}
