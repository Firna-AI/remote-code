//! Git protocol policy at its mocked environment and HTTP boundaries.

use std::sync::Arc;

use unimock::{MockFn, Unimock, matching};

use crate::error::{Error, Result};
use crate::ports::{Context, EnvironmentMock, HttpMock, Reply, StreamsMock};
use crate::service::{Credential, CredentialService};

fn context(turn: &str) -> Context {
    Context {
        origin: "https://machine.test".into(),
        token: "workspace-token".into(),
        turn: turn.into(),
    }
}

#[tokio::test]
async fn supplies_git_protocol_and_token_mode_without_reading_token_stdin() -> Result<()> {
    for (mode, turn) in [("get", "current-turn"), ("token", "")] {
        let mock = Arc::new(Unimock::new((
            EnvironmentMock::context.some_call(matching!()).returns(Ok(context(turn))),
            HttpMock::credential.some_call(matching!((value) if value.origin == "https://machine.test"
                && value.token == "workspace-token" && matches!(value.turn.as_str(), "current-turn" | "")))
                .returns(Ok(Reply { status: 200, body: br#"{"token":"fresh-token"}"#.to_vec() })),
        )));
        let output = if mode == "get" {
            StreamsMock::output.some_call(matching!((value) if value == "username=x-access-token\npassword=fresh-token\n\n")).returns(Ok(()))
        } else {
            StreamsMock::output
                .some_call(matching!((value) if value == "fresh-token\n"))
                .returns(Ok(()))
        };
        let streams = if mode == "get" {
            Arc::new(Unimock::new((
                output,
                StreamsMock::input
                    .some_call(matching!())
                    .returns(Ok("protocol=https\nhost=github.com\n\n".into())),
            )))
        } else {
            Arc::new(Unimock::new(output))
        };
        let service = CredentialService {
            environment: mock.clone(),
            http: mock,
            streams,
        };
        service.execute(mode).await?;
    }
    Ok(())
}

#[tokio::test]
async fn ignores_other_operations_and_other_git_hosts_without_context_or_network() -> Result<()> {
    let unused = Arc::new(Unimock::new(()));
    let service = CredentialService {
        environment: unused.clone(),
        http: unused.clone(),
        streams: unused,
    };
    service.execute("store").await?;
    service.execute("erase").await?;
    for input in [
        "protocol=http\nhost=github.com\n\n",
        "protocol=https\nhost=other.test\n\n",
    ] {
        let mock = Arc::new(Unimock::new(
            StreamsMock::input
                .some_call(matching!())
                .returns(Ok(input.into())),
        ));
        CredentialService {
            environment: mock.clone(),
            http: mock.clone(),
            streams: mock,
        }
        .execute("get")
        .await?;
    }
    Ok(())
}

#[tokio::test]
async fn refuses_git_without_a_turn_before_requesting_a_token() {
    let mock = Arc::new(Unimock::new((
        StreamsMock::input
            .some_call(matching!())
            .returns(Ok("protocol=https\nhost=github.com\n\n".into())),
        EnvironmentMock::context
            .some_call(matching!())
            .returns(Ok(context(""))),
    )));
    let result = CredentialService {
        environment: mock.clone(),
        http: mock.clone(),
        streams: mock,
    }
    .execute("get")
    .await;
    assert!(matches!(result, Err(Error::TurnRequired)));
}

#[tokio::test]
async fn shows_plain_worker_refusals_and_hides_unsafe_or_malformed_replies() {
    for (status, body, message) in [
        (
            409,
            r#"{"error":{"message":"Start an agent turn to use GitHub access."}}"#,
            "Start an agent turn to use GitHub access.",
        ),
        (
            409,
            r#"{"error":{"message":"Sign in\u001b[2J"}}"#,
            "GitHub access failed. Try again.",
        ),
        (
            409,
            r#"{"error":{"message":"Sign in\u200b"}}"#,
            "GitHub access failed. Try again.",
        ),
        (
            401,
            r#"{"token":"must-stay-private"}"#,
            "GitHub access failed. Try again.",
        ),
        (
            200,
            r#"{"token":"secret\npassword=bad"}"#,
            "GitHub access failed. Try again.",
        ),
        (200, r#"{"token":""}"#, "GitHub access failed. Try again."),
        (200, "not json", "GitHub access failed. Try again."),
    ] {
        let mock = Arc::new(Unimock::new((
            EnvironmentMock::context
                .some_call(matching!())
                .returns(Ok(context("turn"))),
            HttpMock::credential
                .some_call(matching!())
                .returns(Ok(Reply {
                    status,
                    body: body.as_bytes().to_vec(),
                })),
        )));
        let result = CredentialService {
            environment: mock.clone(),
            http: mock.clone(),
            streams: mock,
        }
        .execute("token")
        .await;
        assert_eq!(
            result.err().map(|error| error.to_string()).as_deref(),
            Some(message)
        );
    }
}

#[tokio::test]
async fn hides_transport_failure_details() {
    let mock = Arc::new(Unimock::new((
        EnvironmentMock::context
            .some_call(matching!())
            .returns(Ok(context("turn"))),
        HttpMock::credential
            .some_call(matching!())
            .returns(Err(Error::Invalid)),
    )));
    let result = CredentialService {
        environment: mock.clone(),
        http: mock.clone(),
        streams: mock,
    }
    .execute("token")
    .await;
    assert_eq!(
        result.err().map(|error| error.to_string()).as_deref(),
        Some("GitHub access failed. Try again.")
    );
}
