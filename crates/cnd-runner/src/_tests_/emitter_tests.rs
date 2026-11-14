//! Save retries preserve ordering and do not stop later prepared events.

#![allow(clippy::unwrap_used)]

use std::sync::Arc;

use cnd_runner_interface::runner::RunnerEvent;
use serde_json::json;
use unimock::{MockFn, Unimock, matching};

use crate::emitter::{EventEmitter, SavingEmitter};
use crate::error::Error;
use crate::link::ports::RunnerLinkMock;
use crate::test_support::title;

#[tokio::test]
async fn tries_later_output_and_retries_pending_state_without_a_second_append() {
    let output: RunnerEvent = serde_json::from_value(json!({"type":"assistant.delta","sessionId":"s","turnId":"t","messageId":"a","text":"text"})).unwrap();
    let link = Unimock::new((
        RunnerLinkMock::emit
            .next_call(matching!(_, _))
            .returns(Err(Error::Disconnected)),
        RunnerLinkMock::persist
            .next_call(matching!())
            .returns(Err(Error::Disconnected)),
        RunnerLinkMock::emit
            .next_call(matching!((event, _) if *event == title("later")))
            .returns(Ok(())),
    ));
    let emitter: Arc<dyn EventEmitter> = Arc::new(SavingEmitter::new(Arc::new(link)));
    emitter
        .emit(vec![output, title("later")], None)
        .await
        .unwrap();
}

#[tokio::test]
async fn retries_ready_but_propagates_a_failed_start_after_trying_later_events() {
    let ready: RunnerEvent = serde_json::from_value(json!({"type":"runner.ready"})).unwrap();
    let link = Unimock::new((
        RunnerLinkMock::emit
            .next_call(matching!(_, _))
            .returns(Err(Error::Disconnected)),
        RunnerLinkMock::persist
            .next_call(matching!())
            .returns(Ok(())),
        RunnerLinkMock::emit
            .next_call(matching!(_, _))
            .returns(Err(Error::InvalidNumber)),
        RunnerLinkMock::emit
            .next_call(matching!((event, _) if *event == title("later")))
            .returns(Ok(())),
    ));
    let emitter: Arc<dyn EventEmitter> = Arc::new(SavingEmitter::new(Arc::new(link)));
    emitter.emit(vec![ready], None).await.unwrap();
    assert!(matches!(
        emitter
            .emit(vec![title("failed"), title("later")], None)
            .await,
        Err(Error::InvalidNumber)
    ));
}
