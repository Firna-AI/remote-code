//! Turn ownership, exact result lists, and restart continuity.

use std::sync::atomic::Ordering;

use cnd_runner::runtime::CommandHandler;
use cnd_runner_interface::chat_events::{AgentChatEvent, ToolCall, ToolCallKind, ToolCallState};
use cnd_runner_interface::provider_events::{ProviderEvent, ProviderResultState};
use serde_json::json;

use super::builders::{input_ids, message, stop, turn};
use super::helpers::Helpers;
use super::support::{Fixture, TestResult};

#[tokio::test]
async fn streams_output_and_matches_only_the_result_messages_before_ending() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    let helper = h.latest()?;
    helper.event(ProviderEvent::Thinking);
    helper.event(ProviderEvent::Thinking);
    helper.event(ProviderEvent::Delta {
        message_id: "answer".into(),
        text: "Hello ".into(),
    });
    helper.event(ProviderEvent::Delta {
        message_id: "answer".into(),
        text: "world".into(),
    });
    h.command(message("session", "first", "second")?).await?;
    helper.event(ProviderEvent::Answer {
        message_id: "answer".into(),
        text: "Hello world".into(),
        user_message_ids: vec!["message-first".into()],
    });
    helper.event(ProviderEvent::Tool {
        tool: ToolCall {
            id: "tool".into(),
            kind: ToolCallKind::Read,
            target: "README.md".into(),
            detail: None,
            omitted_detail_bytes: 0,
            state: ToolCallState::Running,
        },
    });
    helper.event(ProviderEvent::Result {
        state: ProviderResultState::Stopped,
        user_message_ids: vec!["message-first".into()],
        end_reason: None,
    });
    h.engine.idle().await?;
    assert!(!helper.closed.load(Ordering::SeqCst));
    assert_eq!(input_ids(&helper)?, ["message-first", "message-second"]);
    helper.result(&["unrelated-message"]);
    h.engine.idle().await?;
    assert!(!helper.closed.load(Ordering::SeqCst));
    helper.result(&["message-second"]);
    h.engine.idle().await?;
    let events = serde_json::to_value(h.events().await)?;
    assert_eq!(
        events[1],
        json!({"type":"turn.thinking","sessionId":"session","turnId":"first"})
    );
    assert_eq!(
        events[2],
        json!({"type":"assistant.delta","sessionId":"session","turnId":"first","messageId":"answer","text":"Hello world"})
    );
    assert_eq!(events[3]["userMessageIds"], json!(["message-first"]));
    assert_eq!(events[5]["tool"]["state"], "done");
    assert_eq!(
        events[6],
        json!({"type":"turn.completed","sessionId":"session","turnId":"first","state":"finished","durationMs":0,"files":[],"omittedFileCount":0,"userMessageIds":["message-first","message-second"]})
    );
    assert!(helper.closed.load(Ordering::SeqCst));
    assert_eq!(helper.interrupts.load(Ordering::SeqCst), 0);
    h.close().await
}

#[tokio::test]
async fn ignores_wrong_turns_duplicates_and_stale_helpers_and_resumes_conversations() -> TestResult
{
    let h = Fixture::new().await?;
    let first = turn("session", "first")?;
    h.command(first.clone()).await?;
    h.command(first).await?;
    let helper = h.latest()?;
    h.command(message("session", "wrong", "ignored")?).await?;
    helper.result(&[]);
    h.engine.idle().await?;
    h.command(message("session", "first", "late")?).await?;
    h.command(stop("session", "first", "stop-ended")?).await?;
    assert_eq!(h.events().await.len(), 2);
    h.command(turn("session", "next")?).await?;
    let next = h.latest()?;
    assert_eq!(
        next.options
            .lock()
            .map_err(|_| "test lock poisoned")?
            .as_ref()
            .and_then(|o| o.conversation_id.as_deref()),
        Some("conversation-1")
    );
    helper.event(ProviderEvent::Delta {
        message_id: "stale".into(),
        text: "Old output".into(),
    });
    h.engine.idle().await?;
    assert_eq!(h.events().await.len(), 3);
    next.event(ProviderEvent::Conversation {
        id: "forked-conversation".into(),
    });
    next.result(&[]);
    h.engine.idle().await?;
    h.close().await?;
    let restored = Fixture::open(
        h.memory.clone(),
        std::sync::Arc::new(Helpers::default()),
        None,
    )
    .await?;
    restored.command(turn("session", "restart")?).await?;
    assert_eq!(
        restored
            .latest()?
            .options
            .lock()
            .map_err(|_| "test lock poisoned")?
            .as_ref()
            .and_then(|o| o.conversation_id.as_deref()),
        Some("forked-conversation")
    );
    restored.close().await
}

#[tokio::test]
async fn acknowledges_unknown_stop_once_without_stopping_the_active_turn() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "active")?).await?;
    h.command(stop("session", "unknown", "stop-unknown")?)
        .await?;
    h.command(stop("session", "unknown", "again")?).await?;
    h.command(turn("session", "unknown")?).await?;
    assert_eq!(h.events().await.len(), 2);
    assert!(!h.latest()?.closed.load(Ordering::SeqCst));
    assert_eq!(
        serde_json::to_value(h.events().await)?[1],
        json!({"type":"turn.completed","sessionId":"session","turnId":"unknown","state":"stopped","durationMs":0,"files":[],"omittedFileCount":0,"userMessageIds":[]})
    );
    h.close().await?;
    let restored = Fixture::open(
        h.memory.clone(),
        std::sync::Arc::new(Helpers::default()),
        None,
    )
    .await?;
    restored.command(turn("session", "unknown")?).await?;
    restored
        .command(stop("session", "unknown", "after-restart")?)
        .await?;
    assert_eq!(
        restored
            .helpers
            .processes
            .lock()
            .map_err(|_| "test lock poisoned")?
            .len(),
        0
    );
    assert_eq!(
        restored
            .events()
            .await
            .iter()
            .filter(|event| matches!(event, AgentChatEvent::TurnCompleted { .. }))
            .count(),
        2
    );
    restored.close().await
}

#[tokio::test]
async fn confirms_the_release_after_the_first_welcome_only() -> TestResult {
    let h = Fixture::new().await?;
    assert_eq!(h.startup.welcomes.load(Ordering::SeqCst), 0);
    h.engine.start().await?;
    assert_eq!(h.startup.prepares.load(Ordering::SeqCst), 1);
    assert_eq!(h.startup.welcomes.load(Ordering::SeqCst), 0);
    h.engine.connected().await?;
    h.engine.connected().await?;
    assert_eq!(h.startup.welcomes.load(Ordering::SeqCst), 1);
    h.close().await
}

#[tokio::test(start_paused = true)]
async fn releases_buffered_text_on_the_forty_millisecond_timer() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    let changed = h.memory.changed.notified();
    let helper = h.latest()?;
    helper.event(ProviderEvent::Delta {
        message_id: "answer".into(),
        text: "Buffered".into(),
    });
    helper.event(ProviderEvent::Conversation {
        id: "timed-conversation".into(),
    });
    changed.await;
    h.advance(std::time::Duration::from_millis(39)).await;
    assert_eq!(h.events().await.len(), 1);
    h.advance(std::time::Duration::from_millis(1)).await;
    h.wait_events(2).await;
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["text"],
        "Buffered"
    );
    h.close().await
}
