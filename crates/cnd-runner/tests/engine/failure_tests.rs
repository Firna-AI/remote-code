//! Save failures, restart recovery, output limits, and speed fallback.

use std::sync::atomic::Ordering;

use cnd_runner_interface::chat_events::TurnSpeed;
use cnd_runner_interface::provider_events::ProviderEvent;
use serde_json::json;

use super::builders::{message, stop, turn};
use super::helpers::Helpers;
use super::support::{Fixture, TestResult};

#[tokio::test]
async fn keeps_output_after_a_failed_save_and_retries_the_same_turn_end() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    h.fail("assistant.delta", 1)?;
    let helper = h.latest()?;
    helper.event(ProviderEvent::Delta {
        message_id: "answer".into(),
        text: "Before failure".into(),
    });
    h.engine.idle().await?;
    h.fail("turn.completed", 2)?;
    helper.result(&[]);
    h.engine.idle().await?;
    h.command(stop("session", "first", "retry-end")?).await?;
    let saved = h.store.snapshot().await;
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["text"],
        "Before failure"
    );
    assert_eq!(h.events().await.len(), 3);
    assert_eq!(saved.next_event_number, 4);
    let bytes = h
        .memory
        .bytes
        .lock()
        .map_err(|_| "test lock poisoned")?
        .clone()
        .ok_or("No saved state")?;
    let persisted: serde_json::Value = serde_json::from_slice(&bytes)?;
    assert_eq!(persisted["outbox"].as_array().ok_or("No outbox")?.len(), 3);
    assert!(helper.closed.load(Ordering::SeqCst));
    h.close().await
}

#[tokio::test]
async fn fails_acceptance_or_session_saves_without_starting_an_agent_and_recovers_unfinished_turns()
-> TestResult {
    for kind in ["accept", "session", "turn.started", "checkpoint"] {
        let h = Fixture::new().await?;
        h.fail(kind, 1)?;
        if kind == "checkpoint" {
            h.repositories.fail_baseline.store(true, Ordering::SeqCst);
        }
        h.command(turn("session", "first")?).await?;
        let events = serde_json::to_value(h.events().await)?;
        assert_eq!(
            events
                .as_array()
                .ok_or("No events")?
                .last()
                .ok_or("No end")?["type"],
            "turn.failed"
        );
        assert_eq!(
            events
                .as_array()
                .ok_or("No events")?
                .last()
                .ok_or("No end")?["retryMessageId"],
            "message-first"
        );
        assert_eq!(
            h.helpers
                .processes
                .lock()
                .map_err(|_| "test lock poisoned")?
                .len(),
            0
        );
        h.command(turn("session", "next")?).await?;
        let saved_instructions = h.store.snapshot().await.sessions[0].instructions.clone();
        assert_eq!(
            h.latest()?
                .options
                .lock()
                .map_err(|_| "test lock poisoned")?
                .as_ref()
                .map(|options| options.instructions.clone()),
            saved_instructions
        );
        h.close().await?;
    }
    let h = Fixture::new().await?;
    h.command(turn("session", "unfinished")?).await?;
    let recovered = Fixture::open(
        h.memory.clone(),
        std::sync::Arc::new(Helpers::default()),
        None,
    )
    .await?;
    recovered.command(turn("session", "unfinished")?).await?;
    assert_eq!(
        recovered
            .helpers
            .processes
            .lock()
            .map_err(|_| "test lock poisoned")?
            .len(),
        0
    );
    assert_eq!(
        serde_json::to_value(recovered.events().await)?[1]["state"],
        "stopped"
    );
    recovered.close().await?;
    h.close().await
}

#[tokio::test]
async fn retains_the_first_known_standard_cause_through_stop_and_restart() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    let helper = h.latest()?;
    helper.event(ProviderEvent::Speed {
        speed: TurnSpeed::Fast,
    });
    helper.event(ProviderEvent::Speed {
        speed: TurnSpeed::Standard { cause: None },
    });
    helper.event(ProviderEvent::Speed {
        speed: TurnSpeed::Standard {
            cause: Some("fast_limit".into()),
        },
    });
    helper.event(ProviderEvent::Speed {
        speed: TurnSpeed::Fast,
    });
    h.engine.idle().await?;
    h.command(stop("session", "first", "stop")?).await?;
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["speed"],
        json!({"state":"standard","cause":"fast_limit"})
    );
    h.close().await?;
    let recovered = Fixture::open(
        h.memory.clone(),
        std::sync::Arc::new(Helpers::default()),
        None,
    )
    .await?;
    assert_eq!(
        serde_json::to_value(recovered.events().await)?[1]["speed"],
        json!({"state":"standard","cause":"fast_limit"})
    );
    recovered.close().await
}

#[tokio::test]
async fn filters_split_tokens_before_saving_and_keeps_the_first_retry_identity() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    let helper = h.latest()?;
    helper.event(ProviderEvent::Delta {
        message_id: "answer".into(),
        text: format!("{}secret-", "x".repeat(40_000)),
    });
    h.engine.idle().await?;
    helper.event(ProviderEvent::Delta {
        message_id: "answer".into(),
        text: "alice workspace-token".into(),
    });
    h.engine.idle().await?;
    let events = serde_json::to_string(&h.events().await)?;
    assert!(!events.contains("secret-alice"));
    assert!(!events.contains("workspace-token"));
    assert!(events.contains("[redacted]"));
    helper.fail_send.store(true, Ordering::SeqCst);
    h.command(message("session", "first", "failed")?).await?;
    assert_eq!(
        serde_json::to_value(h.events().await.last())?["retryMessageId"],
        "message-first"
    );
    h.close().await
}

#[tokio::test]
async fn applies_tool_and_file_budgets_after_secret_expansion() -> TestResult {
    let h = Fixture::new().await?;
    let mut command = turn("session", "budget")?;
    if let cnd_runner_interface::runner_commands::RunnerCommand::RunnerTurn(
        cnd_runner_interface::runner_commands::RunnerTurn::Turn { credential, .. },
    ) = &mut command
    {
        *credential = serde_json::from_value(json!({"agent":"claude","kind":"token","token":"x"}))?;
    }
    h.command(command).await?;
    let helper = h.latest()?;
    helper.event(ProviderEvent::Tool { tool:serde_json::from_value(json!({"id":"tool","kind":"read","target":"file","detail":"x".repeat(7000),"omittedDetailBytes":0,"state":"done"}))? });
    h.engine.idle().await?;
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["tool"]["detail"],
        "[redacted]".repeat(6553) + "[red"
    );
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["tool"]["omittedDetailBytes"],
        4466
    );
    let files = ["a", "b", "short"].into_iter().map(|id| serde_json::from_value(json!({"path":if id == "short" { id.into() } else { "x".repeat(15000) + id },"change":"added","added":1,"removed":0}))).collect::<std::result::Result<Vec<_>, _>>()?;
    *h.repositories
        .files
        .lock()
        .map_err(|_| "test lock poisoned")? = files;
    helper.result(&[]);
    h.engine.idle().await?;
    let end = serde_json::to_value(h.events().await)?;
    assert_eq!(end[2]["files"].as_array().ok_or("No files")?.len(), 1);
    assert_eq!(end[2]["files"][0]["path"], "x".repeat(15000) + "a");
    assert_eq!(
        end[2]["files"][0]["displayPath"],
        "[redacted]".repeat(15000) + "a"
    );
    assert_eq!(end[2]["omittedFileCount"], 2);
    h.close().await
}
