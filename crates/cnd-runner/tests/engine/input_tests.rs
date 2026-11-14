//! Input handoff preserves original authority, instructions, and retry identity.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use cnd_runner_interface::agents::Agent;
use cnd_runner_interface::provider_events::ProviderEvent;
use cnd_runner_interface::runner_commands::{RunnerCommand, RunnerMessageDuringTurn, RunnerTurn};
use serde_json::json;

use super::builders::{input_ids, message, turn};
use super::helpers::Helpers;
use super::support::{Fixture, TestResult};

#[tokio::test]
async fn defers_input_in_order_with_original_token_author_and_turn_context() -> TestResult {
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    let first = h.latest()?;
    first.deferred.store(true, Ordering::SeqCst);
    let mut next = message("session", "first", "second")?;
    if let RunnerCommand::RunnerMessageDuringTurn(RunnerMessageDuringTurn::Message {
        message,
        ..
    }) = &mut next
    {
        message.sender.id = "bob".into();
        message.choice.model = "next-model".into();
        message.choice.fast = true;
    }
    h.command(next).await?;
    h.command(message("session", "first", "third")?).await?;
    assert_eq!(input_ids(&first)?, ["message-first"]);
    first.event(ProviderEvent::Tool { tool:serde_json::from_value(json!({"id":"handoff-tool","kind":"read","target":"file","detail":null,"omittedDetailBytes":0,"state":"running"}))? });
    h.engine.idle().await?;
    assert_eq!(first.interrupts.load(Ordering::SeqCst), 1);
    first.output.output(
        cnd_runner_interface::sdk_helper::HelperOutput::BackgroundNotes {
            ids: vec!["task:old".into()],
        },
    );
    first.result(&["message-first"]);
    h.engine.idle().await?;
    let second = h.latest()?;
    assert!(first.closed.load(Ordering::SeqCst));
    assert_eq!(input_ids(&second)?, ["message-second", "message-third"]);
    let options = serde_json::to_value(
        second
            .options
            .lock()
            .map_err(|_| "test lock poisoned")?
            .clone(),
    )?;
    assert_eq!(
        options["credential"],
        json!({"type":"gateway","agent":"claude","kind":"token","token":"secret-alice"})
    );
    assert_eq!(
        options["commitAuthor"],
        json!({"name":"Alice","email":"alice@example.test"})
    );
    assert_eq!(
        options["tools"],
        json!({"machineOrigin":"https://machines.test","workspaceToken":"workspace-token","turnId":"first"})
    );
    assert_eq!(options["conversationId"], "conversation-1");
    assert_eq!(options["choice"]["model"], "next-model");
    assert_eq!(options["choice"]["fast"], true);
    assert_eq!(options["backgroundNoteIds"], json!(["task:old"]));
    second.event(ProviderEvent::Failed {
        code: "provider_failed".into(),
        message: "The provider failed.".into(),
    });
    h.engine.idle().await?;
    assert_eq!(
        serde_json::to_value(h.events().await.last())?,
        json!({"type":"turn.failed","sessionId":"session","turnId":"first","error":{"code":"provider_failed","message":"The provider failed."},"retryMessageId":"message-second","durationMs":0})
    );
    h.close().await
}

#[tokio::test]
async fn rejects_an_agent_change_and_second_turn_without_changing_the_running_agent() -> TestResult
{
    let h = Fixture::new().await?;
    h.command(turn("session", "first")?).await?;
    h.command(turn("session", "other")?).await?;
    let mut wrong = message("session", "first", "wrong")?;
    if let RunnerCommand::RunnerMessageDuringTurn(RunnerMessageDuringTurn::Message {
        message,
        ..
    }) = &mut wrong
    {
        message.choice.agent = Agent::Codex;
    }
    h.command(wrong).await?;
    assert_eq!(input_ids(h.latest()?.as_ref())?, ["message-first"]);
    assert_eq!(
        serde_json::to_value(h.events().await)?[1]["error"]["code"],
        "turn_running"
    );
    assert_eq!(
        serde_json::to_value(h.events().await)?[2]["error"]["code"],
        "session_agent_mismatch"
    );
    h.latest()?.result(&[]);
    h.engine.idle().await?;
    assert_eq!(
        serde_json::to_value(h.events().await.last())?["error"]["code"],
        "session_agent_mismatch"
    );
    assert!(h.latest()?.closed.load(Ordering::SeqCst));
    h.close().await
}

#[tokio::test]
async fn keeps_exact_instructions_and_legacy_branches_across_configuration_changes() -> TestResult {
    let h = Fixture::new().await?;
    let mut command = turn("session", "first")?;
    if let RunnerCommand::RunnerTurn(RunnerTurn::Turn { branches, .. }) = &mut command {
        *branches = Some(cnd_runner_interface::runner_commands::RunnerBranches {
            workspace_branch: "continue/branch".into(),
            target_branch: "develop".into(),
        });
    }
    h.command(command).await?;
    let first = h
        .latest()?
        .options
        .lock()
        .map_err(|_| "test lock poisoned")?
        .clone()
        .ok_or("Missing options")?;
    assert!(
        first
            .instructions
            .contains("Workspace branch: \"continue/branch\"")
    );
    assert!(first.instructions.contains("Target branch: \"develop\""));
    h.latest()?.result(&[]);
    h.engine.idle().await?;
    h.command(turn("session", "next")?).await?;
    let next = h
        .latest()?
        .options
        .lock()
        .map_err(|_| "test lock poisoned")?
        .clone()
        .ok_or("Missing options")?;
    assert_eq!(next.instructions, first.instructions);
    assert_eq!(
        serde_json::to_value(next.instruction_branches)?,
        json!({"workspaceBranch":"continue/branch","targetBranch":"develop"})
    );
    assert_eq!(
        h.store.snapshot().await.sessions[0].instructions,
        Some(first.instructions.clone())
    );
    h.latest()?.result(&[]);
    h.engine.idle().await?;
    h.close().await?;
    let mut legacy = h.store.snapshot().await.sessions[0].clone();
    legacy.instruction_branches = None;
    h.store.remember(legacy).await?;
    let restored = Fixture::open(
        h.memory.clone(),
        Arc::new(Helpers::default()),
        Some(h.store.clone()),
    )
    .await?;
    restored.command(turn("session", "restored")?).await?;
    let options = restored
        .latest()?
        .options
        .lock()
        .map_err(|_| "test lock poisoned")?
        .clone()
        .ok_or("Missing options")?;
    assert_eq!(options.instructions, first.instructions);
    assert_eq!(
        serde_json::to_value(options.instruction_branches)?,
        json!({"workspaceBranch":"continue/branch","targetBranch":"develop"})
    );
    restored.close().await
}
