//! Tolerant optional command fields followed by typed contract checks.

use cnd_runner_interface::agents::Agent;
use cnd_runner_interface::commit_author::CommitAuthor;
use cnd_runner_interface::runner_commands::{RunnerCommand, RunnerMessageDuringTurn, RunnerTurn};
use cnd_runner_interface::runner_credentials::RunnerTurnCredential;
use cnd_runner_interface::runner_handshake::WorkspaceToRunner;
use serde_json::Value;

use crate::error::{Error, ErrorResultExt, Result};

use super::codec::{decode_value, encode};

/// Parse one workspace frame without refusing user text with lone surrogates.
pub fn workspace_message(bytes: &[u8]) -> Result<WorkspaceToRunner> {
    let mut input = decode_value(bytes)?;
    if input.get("type").and_then(Value::as_str) == Some("turn") {
        if let Some(credential) = input.get_mut("credential").and_then(Value::as_object_mut)
            && credential
                .get("promptCacheTtl")
                .is_some_and(|v| v.as_str() != Some("1h"))
        {
            credential.remove("promptCacheTtl");
        }
        if let Some(author) = input.get_mut("commitAuthor").filter(|v| !v.is_null())
            && serde_json::from_value::<CommitAuthor>(author.clone()).is_err()
        {
            tracing::warn!("The turn commit author is invalid. The sandbox author will be used.");
            *author = Value::Null;
        }
    }
    let message: WorkspaceToRunner = serde_json::from_value(input).internal()?;
    encode(&message)?;
    if let WorkspaceToRunner::RunnerCommand(command) = &message {
        match command.as_ref() {
            RunnerCommand::RunnerTurn(RunnerTurn::Turn {
                session_id,
                message,
                credential,
                ..
            }) => {
                let agent = match credential {
                    RunnerTurnCredential::Claude { .. } => Agent::Claude,
                    RunnerTurnCredential::Codex { .. } => Agent::Codex,
                };
                if message.session_id != *session_id || message.choice.agent != agent {
                    return Err(Error::InvalidCommand);
                }
            }
            RunnerCommand::RunnerMessageDuringTurn(RunnerMessageDuringTurn::Message {
                session_id,
                message,
                ..
            }) if message.session_id != *session_id => return Err(Error::InvalidCommand),
            _ => {}
        }
    }
    Ok(message)
}

#[cfg(test)]
#[path = "_tests_/command_tests.rs"]
mod command_tests;
