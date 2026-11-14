//! Typed commands decoded through the production wire reader.

use std::collections::BTreeMap;
use std::path::Path;

use cnd_runner::config::Configuration;
use cnd_runner::json::commands::workspace_message;
use cnd_runner_interface::runner_commands::{RunnerCommand, RunnerMessageDuringTurn, RunnerTurn};
use cnd_runner_interface::runner_handshake::WorkspaceToRunner;
use cnd_runner_interface::sdk_helper_options::ProviderInput;
use serde_json::json;

use super::helpers::Process;

pub(super) fn configuration() -> std::result::Result<Configuration, Box<dyn std::error::Error>> {
    let values = BTreeMap::from([
        ("CONDUCTIVE_WORKSPACE_ID".into(), "workspace".into()),
        (
            "CONDUCTIVE_WORKSPACE_TOKEN".into(),
            "workspace-token".into(),
        ),
        (
            "CONDUCTIVE_RUNNER_URL".into(),
            "wss://machines.test/v1/runner".into(),
        ),
        ("CONDUCTIVE_REPOSITORY".into(), "/repo".into()),
        (
            "CONDUCTIVE_WORKSPACE_BRANCH".into(),
            "workspace/branch".into(),
        ),
        ("CONDUCTIVE_DEFAULT_BRANCH".into(), "main".into()),
    ]);
    Ok(Configuration::parse(
        &values,
        Path::new("/repo"),
        Path::new("/home/user"),
    )?)
}

pub(super) fn turn(
    session: &str,
    id: &str,
) -> std::result::Result<RunnerCommand, Box<dyn std::error::Error>> {
    decode_command(workspace_message(&serde_json::to_vec(
        &json!({ "type": "turn", "commandId": format!("start-{session}-{id}"), "sessionId": session, "turnId": id, "message": { "id": format!("message-{id}"), "sessionId": session, "sender": { "id":"alice", "githubLogin":"alice", "displayName":"Alice", "avatarUrl":null }, "text":"Work", "attachments":[], "choice": {"agent":"claude", "model":"test-model", "effort":"high", "fast":false}, "createdAt":100, "state":"sent" }, "attachments":[], "credential": {"agent":"claude", "kind":"token", "token":"secret-alice"}, "commitAuthor": {"name":"Alice", "email":"alice@example.test"} }),
    )?)?)
}

pub(super) fn message(
    session: &str,
    turn_id: &str,
    id: &str,
) -> std::result::Result<RunnerCommand, Box<dyn std::error::Error>> {
    let RunnerCommand::RunnerTurn(RunnerTurn::Turn {
        command_id,
        session_id,
        message,
        branches,
        attachments,
        ..
    }) = turn(session, id)?
    else {
        return Err("Bad fixture".into());
    };
    Ok(RunnerCommand::RunnerMessageDuringTurn(
        RunnerMessageDuringTurn::Message {
            command_id,
            session_id,
            turn_id: turn_id.into(),
            message,
            branches,
            attachments,
        },
    ))
}
pub(super) fn stop(
    session: &str,
    id: &str,
    command: &str,
) -> std::result::Result<RunnerCommand, Box<dyn std::error::Error>> {
    decode_command(workspace_message(&serde_json::to_vec(
        &json!({"type":"interrupt", "commandId":command, "sessionId":session, "turnId":id}),
    )?)?)
}
pub(super) fn input_ids(
    process: &Process,
) -> std::result::Result<Vec<String>, Box<dyn std::error::Error>> {
    Ok(process
        .inputs
        .lock()
        .map_err(|_| "test lock poisoned")?
        .iter()
        .map(|input| match input {
            ProviderInput::Turn(RunnerTurn::Turn { message, .. })
            | ProviderInput::Message(RunnerMessageDuringTurn::Message { message, .. }) => {
                message.id.clone()
            }
        })
        .collect())
}

fn decode_command(
    message: WorkspaceToRunner,
) -> std::result::Result<RunnerCommand, Box<dyn std::error::Error>> {
    if let WorkspaceToRunner::RunnerCommand(command) = message {
        Ok(*command)
    } else {
        Err("No command".into())
    }
}
