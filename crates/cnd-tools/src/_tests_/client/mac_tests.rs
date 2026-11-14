//! Mac command polling and result rules with a mocked wait boundary.

use serde_json::{Value, json};
use unimock::{MockFn, Unimock, matching};

use crate::client::Dispatch;
use crate::error::{Error, ErrorResultExt, InputError, Result};
use crate::ports::{HttpMock, HttpResponse, RuntimeMock};

use super::fixtures::{
    REQUEST_KEY, TOKEN, TURN, client, command_result, configured, mac, mac_input, response, route,
};

#[tokio::test]
async fn polls_storage_key_after_waiting_and_running_until_completed() -> Result<()> {
    let effects = Unimock::new((
        HttpMock::send.next_call(matching!((request) if request.url == route(&["mac-command"])
            && request.token == TOKEN && request.turn_id.as_deref() == Some(TURN)
            && request.body.as_ref().is_some_and(|body| serde_json::from_str::<Value>(body).is_ok_and(|value| value["requestId"] == ".."))))
            .returns(Ok(response(mac("waiting", Value::Null)))),
        RuntimeMock::wait.next_call(matching!()).returns(()),
        HttpMock::send.next_call(matching!((request) if request.url == route(&["mac-command",REQUEST_KEY])
            && request.token == TOKEN && request.turn_id.as_deref() == Some(TURN) && request.body.is_none()))
            .returns(Ok(response(mac("running", Value::Null)))),
        RuntimeMock::wait.next_call(matching!()).returns(()),
        HttpMock::send.next_call(matching!((request) if request.url == route(&["mac-command",REQUEST_KEY])
            && request.body.is_none())).returns(Ok(response(mac("completed", command_result(json!(0)))))),
    ));
    let reply = configured(effects.clone(), effects, Some(TURN))?
        .execute(mac_input("..")?)
        .await?;
    assert!(!reply.failed());
    assert_eq!(
        serde_json::to_value(reply).internal()?["request"]["result"],
        command_result(json!(0))
    );
    Ok(())
}

#[tokio::test]
async fn returns_each_terminal_mac_outcome_without_polling() -> Result<()> {
    for (state, result, failed) in [
        ("completed", command_result(json!(0)), false),
        ("completed", command_result(json!(17)), true),
        ("completed", command_result(Value::Null), true),
        ("completed", Value::Null, true),
        ("denied", Value::Null, true),
        ("unavailable", Value::Null, true),
        ("timed-out", command_result(Value::Null), true),
        ("failed", Value::Null, true),
    ] {
        let mut raw = mac(state, result);
        raw["private"] = json!(TOKEN);
        raw["request"]["private"] = json!(TOKEN);
        let reply = client(Ok(response(raw)))?
            .execute(mac_input("retry")?)
            .await?;
        assert_eq!(reply.failed(), failed, "{state}");
        assert_eq!(reply.pending_mac(), None, "{state}");
        let value = serde_json::to_value(reply).internal()?;
        assert_eq!(value["request"]["state"], state);
        assert!(value.get("private").is_none());
        assert!(value["request"].get("private").is_none());
    }
    Ok(())
}

#[tokio::test]
async fn requires_active_turn_and_explains_lost_turn_during_polling() -> Result<()> {
    let error = configured(Unimock::new(()), Unimock::new(()), None)?
        .execute(mac_input("retry")?)
        .await
        .err()
        .ok_or(Error::Reply { mac: false })?;
    assert!(matches!(error, Error::Input(InputError::ActiveTurn)));
    assert_eq!(
        error.message(),
        "Start this request from an active agent turn."
    );

    let effects = Unimock::new((
        HttpMock::send.next_call(matching!(_)).returns(Ok(response(mac("waiting", Value::Null)))),
        RuntimeMock::wait.next_call(matching!()).returns(()),
        HttpMock::send.next_call(matching!((request) if request.body.is_none())).returns(Ok(HttpResponse {
            status:403, body:json!({"error":{"code":"calling_turn_required", "message":format!("Access ended for {TOKEN}.")}}).to_string(),
        })),
    ));
    let error = configured(effects.clone(), effects, Some(TURN))?
        .execute(mac_input("retry")?)
        .await
        .err()
        .ok_or(Error::Reply { mac: false })?;
    let Error::Worker {
        status,
        code,
        message,
    } = error
    else {
        return Err(error);
    };
    assert_eq!(
        (status, code.as_str(), message.as_str()),
        (
            403,
            "calling_turn_required",
            "Access ended for [redacted]. The agent turn ended. The tool cannot read the Mac command result."
        )
    );
    Ok(())
}

#[tokio::test]
async fn caps_combined_mac_output_without_splitting_utf8() -> Result<()> {
    let mut raw = mac("completed", command_result(json!(0)));
    raw["request"]["result"]["stdout"] = json!(format!("{}💥", "a".repeat(65_535)));
    raw["request"]["result"]["stderr"] = json!("remaining output");
    let reply = client(Ok(response(raw)))?
        .execute(mac_input("retry")?)
        .await?;
    let value = serde_json::to_value(reply).internal()?;
    assert_eq!(
        value["request"]["result"],
        json!({
            "stdout":"a".repeat(65_535), "stderr":"", "exitCode":0, "timedOut":false, "truncated":true,
        })
    );

    let mut raw = mac("completed", command_result(json!(0)));
    raw["request"]["result"]["stdout"] = json!("a".repeat(65_533));
    raw["request"]["result"]["stderr"] = json!("é💥");
    let reply = client(Ok(response(raw)))?
        .execute(mac_input("retry")?)
        .await?;
    let value = serde_json::to_value(reply).internal()?;
    assert_eq!(value["request"]["result"]["stderr"], "é");
    assert_eq!(value["request"]["result"]["truncated"], true);
    Ok(())
}
