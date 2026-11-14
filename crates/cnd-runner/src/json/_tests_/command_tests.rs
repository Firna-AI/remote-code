//! Command metadata compatibility and credential authority at the wire boundary.

use serde_json::{Value, json};

use crate::error::Error;
use crate::json::commands::workspace_message;

type TestResult = std::result::Result<(), Box<dyn std::error::Error>>;

fn turn() -> Value {
    json!({
        "type":"turn", "commandId":"command", "sessionId":"session", "turnId":"turn",
        "message":{
            "id":"message", "sessionId":"session",
            "sender":{"id":"alice", "githubLogin":"alice", "displayName":null, "avatarUrl":null},
            "text":"Work", "attachments":[
                {"id":"old", "name":"old.txt", "kind":"file", "mediaType":"text/plain", "sizeBytes":7},
                {"id":"null", "name":"null.txt", "path":null, "kind":"file", "mediaType":"text/plain", "sizeBytes":8},
                {"id":"new", "name":"new.txt", "path":".context/attachments/new/new.txt", "kind":"file", "mediaType":"text/plain", "sizeBytes":9}
            ],
            "choice":{"agent":"claude", "model":"test-model", "effort":"high", "fast":true},
            "createdAt":100, "state":"sent"
        },
        "branches":{"workspaceBranch":"owner/continued", "targetBranch":"trunk"},
        "attachments":[{"attachmentId":"new", "path":"/repo/.context/attachments/new/new.txt"}],
        "credential":{"agent":"claude", "kind":"api-key", "token":"temporary"},
        "commitAuthor":{"name":"Alice", "email":"alice@example.test"}
    })
}

#[test]
fn preserves_command_metadata_and_strips_turn_authority_from_messages() -> TestResult {
    for credential in [
        json!({"agent":"claude", "kind":"api-key", "token":"temporary", "promptCacheTtl":"1h"}),
        json!({"agent":"claude", "kind":"token", "token":"temporary"}),
        json!({"agent":"codex", "kind":"api-key", "token":"temporary"}),
        json!({"agent":"codex", "kind":"token", "token":"temporary", "account":{
            "accountId":"account", "email":"alice@example.test", "planType":"pro", "userId":"alice"
        }}),
        json!({"agent":"codex", "kind":"token", "token":"temporary", "account":{
            "accountId":"account", "email":null, "planType":null, "userId":null
        }}),
    ] {
        let mut input = turn();
        input["message"]["choice"]["agent"] = credential["agent"].clone();
        input["credential"] = credential.clone();
        let parsed = serde_json::to_value(workspace_message(&serde_json::to_vec(&input)?)?)?;
        assert_eq!(parsed["credential"], credential);
        assert_eq!(
            parsed["branches"],
            json!({"workspaceBranch":"owner/continued", "targetBranch":"trunk"})
        );
        assert_eq!(
            parsed["commitAuthor"],
            json!({"name":"Alice", "email":"alice@example.test"})
        );
        assert_eq!(
            parsed["attachments"],
            json!([{"attachmentId":"new", "path":"/repo/.context/attachments/new/new.txt"}])
        );
        assert_eq!(
            parsed["message"]["attachments"],
            json!([
                {"id":"old", "name":"old.txt", "path":null, "kind":"file", "mediaType":"text/plain", "sizeBytes":7},
                {"id":"null", "name":"null.txt", "path":null, "kind":"file", "mediaType":"text/plain", "sizeBytes":8},
                {"id":"new", "name":"new.txt", "path":".context/attachments/new/new.txt", "kind":"file", "mediaType":"text/plain", "sizeBytes":9}
            ])
        );
        input["type"] = json!("message");
        let parsed = serde_json::to_value(workspace_message(&serde_json::to_vec(&input)?)?)?;
        assert_eq!(parsed.get("credential"), None);
        assert_eq!(parsed.get("commitAuthor"), None);
        assert_eq!(
            parsed["branches"],
            json!({"workspaceBranch":"owner/continued", "targetBranch":"trunk"})
        );
    }
    for author in [
        Value::Null,
        json!({"name":"Alice"}),
        json!({"name":1,"email":"alice@example.test"}),
        json!({"name":"Alice","email":1}),
    ] {
        let mut input = turn();
        input["commitAuthor"] = author;
        let parsed = serde_json::to_value(workspace_message(&serde_json::to_vec(&input)?)?)?;
        assert_eq!(parsed["commitAuthor"], Value::Null);
    }
    let mut input = turn();
    input
        .as_object_mut()
        .ok_or("Missing command")?
        .remove("commitAuthor");
    let parsed = serde_json::to_value(workspace_message(&serde_json::to_vec(&input)?)?)?;
    assert_eq!(parsed["commitAuthor"], Value::Null);
    Ok(())
}

#[test]
fn rejects_mismatched_identity_and_invalid_temporary_credentials() -> TestResult {
    let mut input = turn();
    input["credential"]["agent"] = json!("codex");
    assert!(matches!(
        workspace_message(&serde_json::to_vec(&input)?),
        Err(Error::InvalidCommand)
    ));
    input = turn();
    input["message"]["sessionId"] = json!("other");
    for kind in ["turn", "message"] {
        input["type"] = json!(kind);
        assert!(matches!(
            workspace_message(&serde_json::to_vec(&input)?),
            Err(Error::InvalidCommand)
        ));
    }
    for credential in [
        Value::Null,
        json!({"agent":"claude", "kind":"unknown", "token":"temporary"}),
        json!({"agent":"codex", "kind":"token", "token":"temporary"}),
        json!({"agent":"codex", "kind":"token", "token":"temporary", "account":{"accountId":123,"email":null,"planType":null,"userId":null}}),
    ] {
        let mut input = turn();
        input["credential"] = credential;
        assert!(matches!(
            workspace_message(&serde_json::to_vec(&input)?),
            Err(Error::Internal(_))
        ));
    }
    Ok(())
}
