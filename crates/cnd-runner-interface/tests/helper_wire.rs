//! Helper JSON snapshots cover each request, output, and agent event form.

use cnd_runner_interface::sdk_helper::{HelperOutput, HelperRequest};

#[test]
fn requests_keep_the_helper_wire_forms() -> Result<(), serde_json::Error> {
    let start = r#"{"type":"start","requestId":"1","options":{"cwd":"/repo","home":"/home/agent","sessionId":"session-1","endpoint":"https://machine.test/v1/model/claude","credential":{"type":"gateway","agent":"claude","kind":"token","token":"fake-turn-token","promptCacheTtl":"1h"},"commitAuthor":{"name":"Alice","email":"alice@example.test"},"choice":{"agent":"claude","model":"test-model","effort":"ultra"},"conversationId":null,"instructions":"Saved instructions","instructionBranches":{"workspaceBranch":"feature","targetBranch":"main"},"tools":{"machineOrigin":"https://machine.test","workspaceToken":"fake-workspace-token","turnId":"turn-1"},"backgroundNoteIds":["task:old"]}}"#;
    let input = r#"{"type":"message","commandId":"message-2","sessionId":"session-1","turnId":"turn-1","message":{"id":"message-2","sessionId":"session-1","sender":{"id":"alice","githubLogin":"alice","displayName":null,"avatarUrl":null},"text":"Hello\nworld","attachments":[],"choice":{"agent":"claude","model":"test-model","effort":"high"},"createdAt":1730000000000,"state":"sent"},"attachments":[]}"#;
    let send = format!(r#"{{"type":"send","requestId":"2","input":{input}}}"#);
    let cases = [
        ("start", start),
        ("send", send.as_str()),
        (
            "model",
            r#"{"type":"model","requestId":"3","choice":{"agent":"codex","model":"test-model","effort":"xhigh"}}"#,
        ),
        ("interrupt", r#"{"type":"interrupt","requestId":"4"}"#),
        ("close", r#"{"type":"close","requestId":"5"}"#),
        ("warm", r#"{"type":"warm","requestId":"6"}"#),
    ];
    for (name, json) in cases {
        let request: HelperRequest = serde_json::from_str(json)?;
        insta::assert_json_snapshot!(name, request);
    }
    let native = start.replace(
        r#"{"type":"gateway","agent":"claude","kind":"token","token":"fake-turn-token","promptCacheTtl":"1h"}"#,
        r#"{"type":"native","login":{"agent":"claude","kind":"api-key","secret":"fake-measurement-key"}}"#,
    );
    let request: HelperRequest = serde_json::from_str(&native)?;
    insta::assert_json_snapshot!("start_native", request);
    Ok(())
}

#[test]
fn outputs_keep_all_provider_event_forms() -> Result<(), serde_json::Error> {
    let cases = [
        (
            "response",
            r#"{"type":"response","requestId":"1","result":null}"#,
        ),
        (
            "model_applied",
            r#"{"type":"response","requestId":"2","result":"applied"}"#,
        ),
        (
            "model_deferred",
            r#"{"type":"response","requestId":"3","result":"deferred"}"#,
        ),
        (
            "error",
            r#"{"type":"error","requestId":"4","code":"agent_failed","message":"Request failed"}"#,
        ),
        (
            "warning",
            r#"{"type":"warning","message":"Computer tools unavailable"}"#,
        ),
        (
            "notes",
            r#"{"type":"background.notes","ids":["task:old","cron:new"]}"#,
        ),
        ("exit", r#"{"type":"exit"}"#),
        (
            "conversation",
            r#"{"type":"event","event":{"type":"conversation","id":"conversation-1"}}"#,
        ),
        (
            "thinking",
            r#"{"type":"event","event":{"type":"thinking"}}"#,
        ),
        (
            "delta",
            r#"{"type":"event","event":{"type":"delta","messageId":"answer-1","text":"hé\nllo"}}"#,
        ),
        (
            "answer",
            r#"{"type":"event","event":{"type":"answer","messageId":"answer-1","text":"Hello","userMessageIds":["message-2","message-1"]}}"#,
        ),
        (
            "tool",
            r#"{"type":"event","event":{"type":"tool","tool":{"id":"tool-1","kind":"run","target":"checks","detail":null,"omittedDetailBytes":0,"state":"done"}}}"#,
        ),
        (
            "background",
            r#"{"type":"event","event":{"type":"background","live":true,"idle":false}}"#,
        ),
        (
            "activity",
            r#"{"type":"event","event":{"type":"activity","idle":true}}"#,
        ),
        (
            "wake_up",
            r#"{"type":"event","event":{"type":"wake-up","state":"stopped"}}"#,
        ),
        (
            "result",
            r#"{"type":"event","event":{"type":"result","state":"finished","userMessageIds":["message-2"]}}"#,
        ),
        (
            "result_with_reason",
            r#"{"type":"event","event":{"type":"result","state":"stopped","userMessageIds":[],"endReason":"background_work_limit"}}"#,
        ),
        (
            "failure",
            r#"{"type":"event","event":{"type":"failed","code":"agent_exited","message":"The agent process ended."}}"#,
        ),
    ];
    for (name, json) in cases {
        let output: HelperOutput = serde_json::from_str(json)?;
        insta::assert_json_snapshot!(name, output);
    }
    Ok(())
}
