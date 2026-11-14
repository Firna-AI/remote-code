//! Mac CLI exit status and MCP error flags retain complete command results.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use unimock::{MockFn, Unimock, matching};

use crate::cli::{Program, ToolProgram};
use crate::client::Configuration;
use crate::error::{Error, ErrorResultExt, InputError, Result};
use crate::ports::{HttpMock, HttpResponse, RuntimeMock, StreamsMock};

fn reply(state: &str, exit_code: Value, timed_out: bool) -> Value {
    json!({"request":{
        "requestId":"..","requestKey":"storage-key","orgId":"org","workspaceId":"workspace",
        "workspaceName":null,"sessionId":"session","turnId":"turn",
        "sender":{"id":"sender","githubLogin":"sender","displayName":null,"avatarUrl":null},
        "device":null,"deviceName":null,"command":"make test","folder":"/tmp","reason":"Check build",
        "timeoutSeconds":60,"longerTimeoutReason":null,"state":state,
        "result":{"stdout":"Build output\n","stderr":"Build failed\n","exitCode":exit_code,"timedOut":timed_out,"truncated":true},
        "error":null,"createdAt":1,"startedAt":2,"updatedAt":3
    }})
}

async fn run(mcp: bool, responses: Vec<HttpResponse>) -> Result<(u8, Vec<String>, Vec<String>)> {
    let polling = responses.len() > 1;
    let response_queue = Arc::new(Mutex::new(VecDeque::from(responses)));
    let output = Arc::new(Mutex::new(Vec::new()));
    let errors = Arc::new(Mutex::new(Vec::new()));
    let lines=Arc::new(Mutex::new(VecDeque::from([
        json!({"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}).to_string(),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}).to_string(),
        json!({"jsonrpc":"2.0","id":"mac","method":"tools/call","params":{"name":"run_mac_command","arguments":{"command":"make test","folder":"/tmp","reason":"Check build","requestId":".."}}}).to_string(),
    ])));
    let core = (
        RuntimeMock::request_id
            .each_call(matching!())
            .returns(String::from("generated-id")),
        HttpMock::send
            .each_call(matching!(_))
            .answers_arc(Arc::new(move |_, _| {
                response_queue
                    .lock()
                    .map_err(|_| Error::Reply { mac: false })?
                    .pop_front()
                    .ok_or(Error::Reply { mac: false })
            })),
    );
    let effects = Arc::new(if polling {
        Unimock::new((core, RuntimeMock::wait.each_call(matching!()).returns(())))
    } else {
        Unimock::new(core)
    });
    let streams = if mcp {
        let setup = (
            StreamsMock::line
                .each_call(matching!())
                .answers_arc(Arc::new(move |_| {
                    Ok(lines
                        .lock()
                        .map_err(|_| Error::Reply { mac: false })?
                        .pop_front())
                })),
            StreamsMock::stdout.each_call(matching!(_)).answers_arc({
                let output = output.clone();
                Arc::new(move |_, text| {
                    output
                        .lock()
                        .map_err(|_| Error::Reply { mac: false })?
                        .push(text.into());
                    Ok(())
                })
            }),
        );
        Unimock::new(setup)
    } else if polling {
        Unimock::new(StreamsMock::stderr.some_call(matching!(_)).answers_arc({
            let errors = errors.clone();
            Arc::new(move |_, text| {
                errors
                    .lock()
                    .map_err(|_| Error::Reply { mac: false })?
                    .push(text.into());
                Ok(())
            })
        }))
    } else {
        Unimock::new(StreamsMock::stdout.some_call(matching!(_)).answers_arc({
            let output = output.clone();
            Arc::new(move |_, text| {
                output
                    .lock()
                    .map_err(|_| Error::Reply { mac: false })?
                    .push(text.into());
                Ok(())
            })
        }))
    };
    let config = Configuration::new(
        Some("https://machine.test".into()),
        Some("token".into()),
        Some("turn".into()),
    )
    .internal()?;
    let program = ToolProgram::new(config, effects.clone(), effects.clone(), Arc::new(streams));
    let status = if mcp {
        program.mcp().await?
    } else {
        program
            .cli(
                &[
                    "mac",
                    "run",
                    "--command",
                    "make test",
                    "--folder",
                    "/tmp",
                    "--reason",
                    "Check build",
                    "--request-id",
                    "..",
                ]
                .map(String::from),
            )
            .await?
    };
    let output = output
        .lock()
        .map_err(|_| Error::Reply { mac: false })?
        .clone();
    let errors = errors
        .lock()
        .map_err(|_| Error::Reply { mac: false })?
        .clone();
    Ok((status, output, errors))
}

#[tokio::test]
async fn unsuccessful_mac_results_keep_json_and_fail_in_both_adapters() -> Result<()> {
    for (state, exit, timed_out) in [
        ("completed", json!(1), false),
        ("completed", Value::Null, false),
        ("timed-out", json!(0), true),
        ("completed", json!(0), false),
    ] {
        let expected = reply(state, exit, timed_out);
        let failed = state != "completed" || expected["request"]["result"]["exitCode"] != 0;
        let response = HttpResponse {
            status: 200,
            body: expected.to_string(),
        };
        let (status, stdout, stderr) = run(false, vec![response.clone()]).await?;
        assert_eq!(status, u8::from(failed));
        assert_eq!(stderr, Vec::<String>::new());
        assert_eq!(stdout.len(), 1);
        assert_eq!(
            serde_json::from_str::<Value>(&stdout[0]).internal()?,
            expected
        );
        let (status, stdout, stderr) = run(true, vec![response]).await?;
        assert_eq!(status, 0);
        assert_eq!(stderr, Vec::<String>::new());
        let result = serde_json::from_str::<Value>(&stdout[1]).internal()?["result"].clone();
        assert_eq!(result["isError"], failed);
        assert_eq!(result["structuredContent"], expected);
        assert_eq!(
            serde_json::from_str::<Value>(
                result["content"][0]["text"]
                    .as_str()
                    .ok_or(Error::Input(InputError::Object))?
            )
            .internal()?,
            expected
        );
    }
    Ok(())
}

#[tokio::test]
async fn stopped_turn_polling_returns_the_worker_refusal_in_both_adapters() -> Result<()> {
    let mut waiting = reply("waiting", Value::Null, false);
    waiting["request"]["result"] = Value::Null;
    let responses=vec![HttpResponse {status:200,body:waiting.to_string()},HttpResponse {status:403,body:json!({"error":{"code":"calling_turn_required","message":"Start this request from an active agent turn."}}).to_string()}];
    let expected = "calling_turn_required: Start this request from an active agent turn. The agent turn ended. The tool cannot read the Mac command result.";
    let (status, stdout, stderr) = run(false, responses.clone()).await?;
    assert_eq!(status, 1);
    assert_eq!(stdout, Vec::<String>::new());
    assert_eq!(stderr, vec![format!("{expected}\n")]);
    let (status, stdout, stderr) = run(true, responses).await?;
    assert_eq!(status, 0);
    assert_eq!(stderr, Vec::<String>::new());
    assert_eq!(
        serde_json::from_str::<Value>(&stdout[1]).internal()?["result"],
        json!({"isError":true,"content":[{"type":"text","text":expected}]})
    );
    Ok(())
}
