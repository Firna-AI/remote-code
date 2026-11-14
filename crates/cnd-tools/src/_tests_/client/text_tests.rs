//! JavaScript text remains readable in accepted writes and refusal replies.

use serde_json::{Value, json};

use crate::call::Call;
use crate::client::Dispatch;
use crate::error::{Error, ErrorResultExt, Result};
use crate::ports::HttpResponse;

use super::fixtures::{accepted, client, decode, list_call};

#[tokio::test]
async fn accepts_a_sent_message_when_the_session_title_has_a_lone_surrogate() -> Result<()> {
    let mut raw = accepted();
    raw["session"]["title"] = json!("before-SURROGATE-after");
    let reply = client(Ok(HttpResponse {
        status: 200,
        body: raw.to_string().replace("SURROGATE", r"\ud800"),
    }))?
    .execute(Call::SendMessage(
        "current".into(),
        "session".into(),
        decode(json!({"text":"Work"}))?,
    ))
    .await;
    assert!(reply.is_ok(), "accepted send failed: {reply:?}");
    let value: Value = serde_json::to_value(reply?).internal()?;
    assert_eq!(value["session"]["title"], "before-�-after");
    assert_eq!(value["message"]["id"], "ask");
    assert_eq!(value["turnId"], "accepted-turn");
    Ok(())
}

#[tokio::test]
async fn keeps_worker_refusals_with_lone_surrogate_text() -> Result<()> {
    let reply = client(Ok(HttpResponse {
        status: 403,
        body: r#"{"error":{"code":"membership_required","message":"before\ud800after"}}"#.into(),
    }))?
    .execute(list_call()?)
    .await;
    assert!(matches!(reply, Err(Error::Worker { status: 403, .. })));
    let error = reply.err().ok_or(Error::Reply { mac: false })?;
    assert_eq!(error.message(), "membership_required: before�after");
    Ok(())
}
