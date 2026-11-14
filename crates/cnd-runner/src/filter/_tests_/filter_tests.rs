//! Literal cases from the shared TypeScript credential filter tests.

use cnd_runner_interface::chat_events::{AgentChatEvent, TurnEventContext};
use cnd_runner_interface::runner::RunnerEvent;

use super::streaming::Sanitizer;

fn delta(text: &str) -> RunnerEvent {
    RunnerEvent::AgentChatEvent(AgentChatEvent::AssistantDelta {
        turn_event_context: context(),
        message_id: "a".into(),
        text: text.into(),
    })
}
fn context() -> TurnEventContext {
    TurnEventContext {
        session_id: "session-a".into(),
        turn_id: "turn-a".into(),
    }
}
fn answer(text: &str) -> RunnerEvent {
    RunnerEvent::AgentChatEvent(AgentChatEvent::AssistantCompleted {
        turn_event_context: context(),
        message_id: "a".into(),
        text: text.into(),
        user_message_ids: vec!["message-a".into()],
    })
}

#[test]
fn masks_marker_credentials_and_preserves_a_standalone_marker() {
    let mut filter = Sanitizer::default();
    filter.secrets = vec!["[redacted]tail".into(), "a".into(), "[".into()];
    assert_eq!(filter.accept(delta("[redacted]")), vec![]);
    assert_eq!(
        filter.accept(delta("tail production a")),
        vec![delta("[redacted] production [redacted]")]
    );
    assert_eq!(
        filter.accept(answer("[redacted]tail production a")),
        vec![answer("[redacted] production [redacted]")]
    );
    assert_eq!(
        filter.text("[redacted] production"),
        "[redacted] production"
    );
    filter.secrets = vec!["x".into(), "[redacted]tail".into()];
    assert_eq!(
        filter.accept(answer("xtail")),
        vec![answer("[redacted]tail")]
    );
}

#[test]
fn masks_only_new_text_after_a_completed_answer_releases_a_prefix() {
    let mut filter = Sanitizer::default();
    filter.secrets.push("private-value".into());
    assert_eq!(
        filter.accept(answer("Final private-")),
        vec![answer("Final private-")]
    );
    assert_eq!(filter.accept(delta("val")), vec![]);
    let mut filter = filter.clone();
    filter.secrets.clear();
    assert_eq!(
        filter.accept(delta("ue and value")),
        vec![delta("[redacted] and value")]
    );
}

#[test]
fn keeps_released_prefix_context_after_the_turn_ends() -> Result<(), Box<dyn std::error::Error>> {
    let mut filter = Sanitizer::default();
    filter.secrets.push("private-value".into());
    assert_eq!(filter.accept(delta("private-")), vec![]);
    filter.secrets.clear();
    let end: RunnerEvent = serde_json::from_str(
        r#"{"type":"turn.completed","sessionId":"session-a","turnId":"turn-a","state":"finished","durationMs":1,"files":[],"omittedFileCount":0,"userMessageIds":["message-a"]}"#,
    )?;
    assert_eq!(filter.accept(end.clone()), vec![delta("private-"), end]);
    assert_eq!(
        filter.accept(delta("value and value")),
        vec![delta("[redacted] and value")]
    );
    Ok(())
}

#[test]
fn masks_overlapping_and_historical_tokens_without_mixing_message_contexts() {
    let mut filter = Sanitizer::default();
    filter.secrets = vec![
        "abc".into(),
        "abcdef".into(),
        "sk-fake-gateway-turn-token".into(),
    ];
    assert_eq!(
        filter.accept(delta("Login: sk-fake-")),
        vec![delta("Login: ")]
    );
    assert_eq!(
        filter.accept(delta("gateway-turn-token.")),
        vec![delta("[redacted].")]
    );
    assert_eq!(filter.text("abcdef abc"), "[redacted] [redacted]");
    assert_eq!(
        filter.accept(answer("Final sk-fake-")),
        vec![answer("Final sk-fake-")]
    );
    let mut restored = filter.clone();
    restored.secrets.clear();
    assert_eq!(
        restored.accept(delta("gateway-turn-token")),
        vec![delta("[redacted]")]
    );
}

#[test]
fn flushes_held_messages_in_original_insertion_order() -> Result<(), Box<dyn std::error::Error>> {
    let mut filter = Sanitizer::default();
    filter.secrets.push("private-value".into());
    let other = RunnerEvent::AgentChatEvent(AgentChatEvent::AssistantDelta {
        turn_event_context: context(),
        message_id: "b".into(),
        text: "private-".into(),
    });
    assert_eq!(filter.accept(delta("priv")), vec![]);
    assert_eq!(filter.accept(other.clone()), vec![]);
    assert_eq!(filter.accept(delta("ate-")), vec![]);
    let end: RunnerEvent = serde_json::from_str(
        r#"{"type":"turn.failed","sessionId":"session-a","turnId":"turn-a","error":{"code":"failed","message":"Failed"},"retryMessageId":"message-a","durationMs":0}"#,
    )?;
    assert_eq!(
        filter.accept(end.clone()),
        vec![delta("private-"), other, end]
    );
    Ok(())
}
