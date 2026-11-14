//! Fast choices and speed reports keep their JSON forms across each boundary.

use cnd_runner_interface::agents::AgentChoice;
use cnd_runner_interface::chat_events::AgentChatEvent;
use cnd_runner_interface::sdk_helper::HelperOutput;
use cnd_runner_interface::tools::resources::AgentModel;
use cnd_runner_interface::tools::sessions::{AgentCreateSessionRequest, AgentSendMessageRequest};
use cnd_runner_interface::tools::workspaces::AgentCreateWorkspaceRequest;

#[test]
fn choices_and_tool_overrides_keep_fast_and_omission() -> Result<(), serde_json::Error> {
    let choice: AgentChoice = serde_json::from_str(
        r#"{"agent":"codex","model":"test-model","effort":"high","fast":true}"#,
    )?;
    insta::assert_json_snapshot!("fast_choice", choice);
    let older: AgentChoice =
        serde_json::from_str(r#"{"agent":"claude","model":"test-model","effort":"high"}"#)?;
    insta::assert_json_snapshot!("older_choice_defaults_standard", older);
    for (name, json) in [
        (
            "model_offers_fast",
            r#"{"agent":"claude","model":"test-model","label":"Test","efforts":["high"],"fast":true}"#,
        ),
        (
            "model_without_fast",
            r#"{"agent":"claude","model":"test-model","label":"Test","efforts":["high"]}"#,
        ),
    ] {
        let model: AgentModel = serde_json::from_str(json)?;
        insta::assert_json_snapshot!(name, model);
    }
    let workspace: AgentCreateWorkspaceRequest =
        serde_json::from_str(r#"{"repositoryId":"repo","firstMessage":"Work","fast":true}"#)?;
    insta::assert_json_snapshot!("workspace_fast_override", workspace);
    let session: AgentCreateSessionRequest = serde_json::from_str(r#"{"fast":true}"#)?;
    insta::assert_json_snapshot!("session_fast_override", session);
    for (name, json) in [
        ("send_fast_omitted", r#"{"text":"Keep speed"}"#),
        (
            "send_fast_disabled",
            r#"{"text":"Standard speed","fast":false}"#,
        ),
    ] {
        let send: AgentSendMessageRequest = serde_json::from_str(json)?;
        insta::assert_json_snapshot!(name, send);
    }
    Ok(())
}

#[test]
fn helper_and_turn_completion_keep_each_speed_form() -> Result<(), serde_json::Error> {
    for (name, speed) in [
        ("fast", r#"{"state":"fast"}"#),
        ("standard", r#"{"state":"standard"}"#),
        (
            "standard_cause",
            r#"{"state":"standard","cause":"fast_limit"}"#,
        ),
    ] {
        let event: HelperOutput = serde_json::from_str(&format!(
            r#"{{"type":"event","event":{{"type":"speed","speed":{speed}}}}}"#
        ))?;
        insta::assert_json_snapshot!(format!("helper_speed_{name}"), event);
        let completed: AgentChatEvent = serde_json::from_str(&format!(
            r#"{{"sessionId":"session","turnId":"turn","type":"turn.completed","state":"finished","durationMs":1000,"files":[],"omittedFileCount":0,"userMessageIds":[],"speed":{speed}}}"#
        ))?;
        insta::assert_json_snapshot!(format!("completed_speed_{name}"), completed);
    }
    Ok(())
}
