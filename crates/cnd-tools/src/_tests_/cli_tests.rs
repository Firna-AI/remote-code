//! CLI compatibility through mocked HTTP and input streams.

use std::sync::Arc;

use serde_json::{Value, json};
use unimock::{MockFn, Unimock, matching};

use crate::cli::{HELP, Program, ToolProgram, help_requested};
use crate::client::Configuration;
use crate::error::{Error, ErrorResultExt, InputError, Result};
use crate::ports::{HttpMock, HttpResponse, RuntimeMock, StreamsMock};

fn arguments(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).into()).collect()
}
fn config() -> Result<Configuration> {
    Configuration::new(
        Some("https://machine.test".into()),
        Some("token".into()),
        Some("turn".into()),
    )
}

#[tokio::test]
async fn help_and_invalid_options_send_no_request() -> Result<()> {
    assert!(help_requested(&arguments(&["sessions", "send", "--help"])));
    assert!(!help_requested(&arguments(&[
        "sessions",
        "send",
        "--message",
        "--help",
        "--session",
        "-missing"
    ])));
    let mock = Arc::new(Unimock::new((
        StreamsMock::stdout
            .some_call(matching!((text) if *text == HELP))
            .answers(&|_, _| Ok(())),
        StreamsMock::stderr
            .some_call(matching!(
                "Check the session options. Use --help for details.\n"
            ))
            .answers(&|_, _| Ok(())),
        StreamsMock::stderr
            .some_call(matching!("Choose Claude or Codex for the workspace.\n"))
            .answers(&|_, _| Ok(())),
        StreamsMock::stderr
            .some_call(matching!("Complete the required workspace fields.\n"))
            .answers(&|_, _| Ok(())),
        RuntimeMock::request_id
            .some_call(matching!())
            .returns(String::from("retry-id")),
    )));
    let program = ToolProgram::new(config()?, mock.clone(), mock.clone(), mock.clone());
    assert_eq!(
        program
            .cli(&arguments(&["sessions", "send", "--help"]))
            .await?,
        0
    );
    assert_eq!(
        program
            .cli(&arguments(&["sessions", "send", "--session"]))
            .await?,
        1
    );
    assert_eq!(
        program
            .cli(&arguments(&[
                "sessions",
                "create",
                "--model",
                "orphan-model"
            ]))
            .await?,
        1
    );
    assert_eq!(
        program
            .cli(&arguments(&["sessions", "create", "--message-file", " "]))
            .await?,
        1
    );
    assert!(matches!(
        Configuration::new(Some("https://machine.test".into()), None, None),
        Err(Error::Input(InputError::Credentials))
    ));
    Ok(())
}

#[tokio::test]
async fn message_files_and_stdin_preserve_utf8_and_conflicts_send_no_request() -> Result<()> {
    const EXPECTED: &str = "  café 🧭\r\nKeep spaces.  \r\n";
    let mock=Arc::new(Unimock::new((
        RuntimeMock::message.each_call(matching!("task with spaces.md")).answers(&|_, _| Ok(EXPECTED.into())),
        RuntimeMock::message.each_call(matching!("-")).answers(&|_, _| Ok(EXPECTED.into())),
        RuntimeMock::message.some_call(matching!("missing")).returns(Err(Error::Input(InputError::MessageFile))),
        RuntimeMock::request_id.each_call(matching!()).returns(String::from("retry-id")),
        HttpMock::send.each_call(matching!((request) if request.body.as_ref().is_some_and(|body| serde_json::from_str::<Value>(body).is_ok_and(|value| value.get("firstMessage").or_else(|| value.get("text")).is_some_and(|text| text == EXPECTED)))))
            .answers(&|_,_|Ok(HttpResponse {status:403,body:json!({"error":{"code":"stopped","message":"Stop"}}).to_string()})),
        StreamsMock::stderr.each_call(matching!((text) if ["stopped: Stop\n","Use --message or --message-file for one message.\n","The message file could not be read. Check its path and try again.\n"].contains(text))).answers(&|_, _| Ok(())),
    )));
    let program = ToolProgram::new(config()?, mock.clone(), mock.clone(), mock.clone());
    for prefix in [
        &["workspaces", "create", "--repository", "repo"][..],
        &["sessions", "create"][..],
        &["sessions", "send", "--session", "session"][..],
    ] {
        for source in ["task with spaces.md", "-"] {
            let mut args = arguments(prefix);
            args.extend(arguments(&["--message-file", source]));
            assert_eq!(program.cli(&args).await?, 1);
        }
    }
    assert_eq!(
        program
            .cli(&arguments(&[
                "sessions",
                "send",
                "--message",
                "inline",
                "--message-file",
                "-"
            ]))
            .await?,
        1
    );
    assert_eq!(
        program
            .cli(&arguments(&[
                "sessions",
                "send",
                "--message-file",
                "missing"
            ]))
            .await?,
        1
    );
    let failing_stdin = Arc::new(Unimock::new((
        RuntimeMock::message
            .some_call(matching!("-"))
            .returns(Err(Error::Input(InputError::MessageStdin))),
        StreamsMock::stderr
            .some_call(matching!(
                "The message could not be read from stdin. Try again.\n"
            ))
            .answers(&|_, _| Ok(())),
    )));
    let program = ToolProgram::new(
        config()?,
        failing_stdin.clone(),
        failing_stdin.clone(),
        failing_stdin,
    );
    assert_eq!(
        program
            .cli(&arguments(&["sessions", "create", "--message-file", "-"]))
            .await?,
        1
    );
    Ok(())
}

#[tokio::test]
async fn dash_prefixed_session_values_are_sent_exactly() -> Result<()> {
    let mock=Arc::new(Unimock::new((
        RuntimeMock::request_id.some_call(matching!()).returns(String::from("generated-id")),
        HttpMock::send.some_call(matching!((request) if request.url.ends_with("/sessions/-missing/messages") && request.body.as_ref().is_some_and(|body| serde_json::from_str::<Value>(body).is_ok_and(|value| value["text"] == "--help"))))
            .returns(Ok(HttpResponse {status:404,body:json!({"error":{"code":"session_not_found","message":"Session missing."}}).to_string()})),
        StreamsMock::stderr.some_call(matching!("session_not_found: Session missing.\n")).answers(&|_, _| Ok(())),
    )));
    let program = ToolProgram::new(config()?, mock.clone(), mock.clone(), mock.clone());
    assert_eq!(
        program
            .cli(&arguments(&[
                "sessions",
                "send",
                "--session",
                "-missing",
                "--message",
                "--help"
            ]))
            .await?,
        1
    );
    Ok(())
}

#[tokio::test]
async fn fast_overrides_are_boolean_and_invalid_values_send_no_request() -> Result<()> {
    for (extra, expected) in [
        (vec!["--fast", "true"], Some(true)),
        (vec!["--fast=false"], Some(false)),
        (vec![], None),
    ] {
        let mock = Arc::new(Unimock::new((
            RuntimeMock::request_id
                .some_call(matching!())
                .returns(String::from("retry")),
            HttpMock::send
                .some_call(matching!(_))
                .answers_arc(Arc::new(move |_, request| {
                    let body: Value = serde_json::from_str(
                        request.body.as_deref().ok_or(Error::Reply { mac: false })?,
                    )
                    .internal()?;
                    assert_eq!(body.get("fast").and_then(Value::as_bool), expected);
                    Ok(HttpResponse {
                        status: 403,
                        body: json!({"error":{"code":"stopped","message":"Stop"}}).to_string(),
                    })
                })),
            StreamsMock::stderr
                .some_call(matching!("stopped: Stop\n"))
                .answers(&|_, _| Ok(())),
        )));
        let program = ToolProgram::new(config()?, mock.clone(), mock.clone(), mock.clone());
        let mut args = vec![
            "sessions",
            "send",
            "--session",
            "session",
            "--message",
            "Work",
        ];
        args.extend(extra);
        assert_eq!(program.cli(&arguments(&args)).await?, 1);
    }
    let mock = Arc::new(Unimock::new(
        StreamsMock::stderr
            .some_call(matching!("Choose true or false for fast mode.\n"))
            .answers(&|_, _| Ok(())),
    ));
    let program = ToolProgram::new(config()?, mock.clone(), mock.clone(), mock.clone());
    assert_eq!(
        program
            .cli(&arguments(&["sessions", "create", "--fast", "yes"]))
            .await?,
        1
    );
    Ok(())
}
