//! Literal tool replies and mocked effects shared by Client tests.

use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use unimock::{MockFn, Unimock, matching};

use crate::call::Call;
use crate::client::{Client, Configuration};
use crate::error::{ErrorResultExt, Result};
use crate::ports::{HttpMock, HttpResponse};

pub(super) const TOKEN: &str = "workspace-secret-client-tests";
pub(super) const TURN: &str = "active-turn";
pub(super) const REQUEST_KEY: &str = "qR4jNqQnVdQ8h2AfdA4JSS36LguAFa8h_wWzQ1wQyzQ";

pub(super) fn configured(http: Unimock, runtime: Unimock, turn: Option<&str>) -> Result<Client> {
    Ok(Client::new(
        Configuration::new(
            Some("https://machine.conductive.test".into()),
            Some(TOKEN.into()),
            turn.map(String::from),
        )?,
        Arc::new(http),
        Arc::new(runtime),
    ))
}

pub(super) fn client(response: Result<HttpResponse>) -> Result<Client> {
    configured(
        Unimock::new(HttpMock::send.some_call(matching!(_)).returns(response)),
        Unimock::new(()),
        Some(TURN),
    )
}

pub(super) fn response(body: Value) -> HttpResponse {
    HttpResponse {
        status: 200,
        body: body.to_string(),
    }
}

pub(super) fn route(parts: &[&str]) -> String {
    format!(
        "https://machine.conductive.test/v1/tools/{}",
        parts.join("/")
    )
}

pub(super) fn decode<T: DeserializeOwned>(body: Value) -> Result<T> {
    serde_json::from_value(body).internal()
}

pub(super) fn list_call() -> Result<Call> {
    Ok(Call::ListWorkspaces(decode(json!({}))?))
}

pub(super) fn workspace() -> Value {
    json!({
        "id": "workspace", "number": 1,
        "link": "https://app.conductive.test/org/workspace",
        "name": "Lisbon", "branch": "member/lisbon-ab12", "state": "input"
    })
}

pub(super) fn listed_workspaces() -> Value {
    let mut item = workspace();
    item["owner"] = json!({"id":"owner", "githubLogin":"member", "displayName":null});
    json!({"workspaces":[item]})
}

pub(super) fn message() -> Value {
    json!({
        "id":"ask", "sessionId":"session", "text":"Work", "attachments":[],
        "sender":{"id":"owner", "githubLogin":"member", "displayName":null, "avatarUrl":null},
        "choice":{"agent":"codex", "model":"model", "effort":"high"},
        "createdAt":1000, "state":"sent"
    })
}

pub(super) fn accepted() -> Value {
    json!({
        "workspace":workspace(), "eventNumber":7,
        "session":{
            "id":"session", "workspaceId":"workspace", "title":null,
            "choice":{"agent":"codex", "model":"model", "effort":"high"},
            "createdAt":1000, "closedAt":null, "activeTurnId":null,
            "activeTurnStartedAt":null, "retryMessageId":null, "startedBy":null,
            "sourceSessionId":null, "loginAvailable":true, "loginShared":false,
            "link":"https://app.conductive.test/org/workspace/session"
        },
        "resume":{"state":"failed", "error":{"code":"start_failed", "message":"Try the start again."}},
        "message":message(), "turnId":"accepted-turn"
    })
}

pub(super) fn transcript() -> Value {
    json!({
        "workspace":workspace(),
        "session":{"id":"session", "link":"https://app.conductive.test/session"},
        "detail":"full", "markdown":"", "startLine":2, "endLine":3,
        "totalLines":9, "startOffset":0, "endOffset":2,
        "next":{"line":3, "offset":2}
    })
}

pub(super) fn mac_input(id: &str) -> Result<Call> {
    Ok(Call::RunMacCommand(decode(json!({
        "requestId":id, "command":"pwd", "folder":"/tmp", "reason":"Check folder"
    }))?))
}

pub(super) fn mac(state: &str, result: Value) -> Value {
    json!({"request":{
        "requestId":"..", "requestKey":REQUEST_KEY, "orgId":"org",
        "workspaceId":"workspace", "workspaceName":null, "sessionId":"session", "turnId":TURN,
        "sender":{"id":"owner", "githubLogin":"member", "displayName":null, "avatarUrl":null},
        "device":null, "deviceName":null, "command":"pwd", "folder":"/tmp", "reason":"Check folder",
        "timeoutSeconds":60, "longerTimeoutReason":null, "state":state,
        "result":result, "error":null, "createdAt":1000, "startedAt":null, "updatedAt":1000
    }})
}

pub(super) fn command_result(exit_code: Value) -> Value {
    json!({"stdout":"/tmp\n", "stderr":"", "exitCode":exit_code, "timedOut":false, "truncated":false})
}
