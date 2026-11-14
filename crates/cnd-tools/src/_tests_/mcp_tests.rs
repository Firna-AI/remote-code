//! Protocol lifecycle, concurrent replies, and EOF cleanup through stdio effects.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use unimock::{MockFn, Unimock, matching};

use crate::client::{Client, Configuration};
use crate::error::{Error, ErrorResultExt, InputError, Result};
use crate::mcp::{Mcp, Server};
use crate::ports::{HttpMock, HttpResponse, RuntimeMock, StreamsMock};

fn initialize() -> String {
    json!({"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"unknown-version","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}).to_string()
}
fn initialized() -> String {
    json!({"jsonrpc":"2.0","method":"notifications/initialized"}).to_string()
}
fn request(id: Value, method: &str, params: Value) -> String {
    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string()
}
fn call(id: &str, name: &str, arguments: Value) -> String {
    request(
        json!(id),
        "tools/call",
        json!({"name":name,"arguments":arguments}),
    )
}

async fn serve(lines: Vec<String>, fail_reply: bool) -> Result<(u8, Vec<Value>, Vec<String>)> {
    let (status, lines, errors) = serve_raw(lines, fail_reply).await?;
    let replies = lines
        .iter()
        .map(|line| serde_json::from_str(line).internal())
        .collect::<Result<_>>()?;
    Ok((status, replies, errors))
}

async fn serve_raw(lines: Vec<String>, fail_reply: bool) -> Result<(u8, Vec<String>, Vec<String>)> {
    let input = Arc::new(Mutex::new(VecDeque::from(lines)));
    let output = Arc::new(Mutex::new(Vec::new()));
    let errors = Arc::new(Mutex::new(Vec::new()));
    let setup = (
        StreamsMock::line.each_call(matching!()).answers_arc({
            let input = input.clone();
            Arc::new(move |_| {
                Ok(input
                    .lock()
                    .map_err(|_| Error::Reply { mac: false })?
                    .pop_front())
            })
        }),
        StreamsMock::stdout.each_call(matching!(_)).answers_arc({
            let output = output.clone();
            Arc::new(move |_, text| {
                if fail_reply && serde_json::from_str::<Value>(text).internal()?["id"] == "list" {
                    return Err(Error::Network { mac: false });
                }
                output
                    .lock()
                    .map_err(|_| Error::Reply { mac: false })?
                    .push(text.to_string());
                Ok(())
            })
        }),
        RuntimeMock::request_id
            .each_call(matching!())
            .returns(String::from("generated-id")),
        HttpMock::send.each_call(matching!(_)).answers(&|_, _| {
            Ok(HttpResponse {
                status: 200,
                body: "{\"workspaces\":[]}".into(),
            })
        }),
    );
    let mock = Arc::new(if fail_reply {
        Unimock::new((
            setup,
            StreamsMock::stderr
                .each_call(matching!(_))
                .answers_arc({
                    let errors = errors.clone();
                    Arc::new(move |_, text| {
                        errors
                            .lock()
                            .map_err(|_| Error::Reply { mac: false })?
                            .push(text.to_string());
                        Ok(())
                    })
                })
                .at_least_times(0),
        ))
    } else {
        Unimock::new(setup)
    });
    let config = Configuration::new(
        Some("https://machine.test".into()),
        Some("token".into()),
        Some("turn".into()),
    )
    .internal()?;
    let client = Arc::new(Client::new(config, mock.clone(), mock.clone()));
    let server = Server::new(client);
    let status = server.serve(mock.clone(), mock.clone()).await?;
    let replies = output
        .lock()
        .map_err(|_| Error::Reply { mac: false })?
        .clone();
    let errors = errors
        .lock()
        .map_err(|_| Error::Reply { mac: false })?
        .clone();
    Ok((status, replies, errors))
}

#[tokio::test]
async fn separates_protocol_errors_from_tool_errors_and_ignores_notifications() -> Result<()> {
    let (status, replies, errors) = serve(
        vec![
            "{".into(),
            request(json!(1), "tools/list", json!({})),
            initialize(),
            initialized(),
            request(json!(2), "unknown-method", json!({})),
            call("unknown", "unknown-tool", json!({})),
            call("array", "create_workspace", json!([])),
            call("missing", "create_workspace", json!({})),
            request(json!(7.0), "tools/list", json!("bad")),
            json!({"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_workspaces"}})
                .to_string(),
            request(json!("discovery"), "tools/list", json!({})),
            call("list", "list_workspaces", json!({})),
        ],
        false,
    )
    .await?;
    assert_eq!(status, 0);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(replies.len(), 10);
    let by_id = |id: Value| {
        replies
            .iter()
            .find(|reply| reply["id"] == id)
            .ok_or(Error::Reply { mac: false })
    };
    for (id, code) in [
        (Value::Null, -32700),
        (json!(1), -32600),
        (json!(2), -32601),
        (json!("unknown"), -32602),
        (json!("array"), -32602),
        (json!(7.0), -32602),
    ] {
        assert_eq!(by_id(id)?["error"]["code"], code);
    }
    let tools = by_id(json!("discovery"))?["result"]["tools"]
        .as_array()
        .ok_or(Error::Input(InputError::Object))?;
    assert_eq!(tools.len(), 24);
    for name in ["create_workspace", "create_session", "send_message"] {
        let tool = tools
            .iter()
            .find(|tool| tool["name"] == name)
            .ok_or(Error::Reply { mac: false })?;
        assert_eq!(tool["inputSchema"]["properties"]["fast"]["type"], "boolean");
    }
    let mac = tools
        .iter()
        .find(|tool| tool["name"] == "run_mac_command")
        .ok_or(Error::Reply { mac: false })?;
    assert_eq!(
        mac["inputSchema"]["required"],
        json!(["command", "folder", "reason"])
    );
    assert_eq!(
        mac["annotations"],
        json!({"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false})
    );
    assert_eq!(
        by_id(json!("init"))?["result"]["protocolVersion"],
        "2025-11-25"
    );
    assert_eq!(
        by_id(json!("missing"))?["result"],
        json!({"isError":true,"content":[{"type":"text","text":"Complete the required workspace fields."}]})
    );
    assert_eq!(
        by_id(json!("list"))?["result"],
        json!({"isError":false,"structuredContent":{"workspaces":[]},"content":[{"type":"text","text":"{\"workspaces\":[]}"}]})
    );
    Ok(())
}

#[tokio::test]
async fn ping_overtakes_http_and_eof_drains_pending_replies() -> Result<()> {
    let (status, replies, errors) = serve(
        vec![
            initialize(),
            initialized(),
            call("list", "list_workspaces", json!({})),
            request(json!("ping"), "ping", json!({})),
        ],
        false,
    )
    .await?;
    assert_eq!(status, 0);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(
        replies
            .iter()
            .map(|reply| reply["id"].clone())
            .collect::<Vec<_>>(),
        vec![json!("init"), json!("ping"), json!("list")]
    );
    Ok(())
}

#[tokio::test]
async fn output_failure_sets_exit_one_and_keeps_other_replies() -> Result<()> {
    let (status, replies, errors) = serve(
        vec![
            initialize(),
            initialized(),
            call("list", "list_workspaces", json!({})),
            request(json!("ping"), "ping", json!({})),
        ],
        true,
    )
    .await?;
    assert_eq!(status, 1);
    assert_eq!(errors, vec!["The workspace request failed. Try again.\n"]);
    assert_eq!(
        replies
            .iter()
            .map(|reply| reply["id"].clone())
            .collect::<Vec<_>>(),
        vec![json!("init"), json!("ping")]
    );
    Ok(())
}

#[tokio::test]
async fn accepts_lone_surrogates_in_mcp_arguments_and_preserves_the_request_id() -> Result<()> {
    let (status, replies, errors) = serve_raw(
        vec![
            initialize(),
            initialized(),
            call("control", "list_workspaces", json!({})),
            r#"{"jsonrpc":"2.0","id":"surrogate","method":"tools/call","params":{"name":"list_workspaces","arguments":{"query":"before\ud800after"}}}"#.into(),
            r#"{"jsonrpc":"2.0","\ud800":null,"id":"discarded","i\u0064":"req-\ud800","method":"tools/call","params":{"name":"list_workspaces","arguments":{"query":"before\ud800after"}}}"#.into(),
            r#"{"jsonrpc":"2.0","id":"req-\ud801","method":"tools/call","params":{"name":"list_workspaces","arguments":{"query":"before\ud801after"}}}"#.into(),
            r#"{"jsonrpc":"1.0","id":"req-\ud800","method":"ping"}"#.into(),
            r#"{"jsonrpc":"2.0","id":"req-\ud801","method":"unknown-method"}"#.into(),
        ],
        false,
    )
    .await?;
    assert_eq!(status, 0);
    assert_eq!(errors, Vec::<String>::new());
    assert_eq!(replies.len(), 7);
    let result = r#"{"content":[{"type":"text","text":"{\"workspaces\":[]}"}],"structuredContent":{"workspaces":[]},"isError":false}"#;
    let mut expected = [
        r#""control""#,
        r#""surrogate""#,
        r#""req-\ud800""#,
        r#""req-\ud801""#,
    ]
    .map(|id| format!("{{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{result}}}\n"))
    .to_vec();
    expected.extend([
        r#"{"jsonrpc":"2.0","id":"req-\ud800","error":{"code":-32600,"message":"Invalid JSON-RPC request."}}"#,
        r#"{"jsonrpc":"2.0","id":"req-\ud801","error":{"code":-32601,"message":"Method not found."}}"#,
    ].map(|line| format!("{line}\n")));
    let mut replies: Vec<_> = replies.into_iter().skip(1).collect();
    replies.sort();
    expected.sort();
    assert_eq!(replies, expected);
    Ok(())
}
