//! Session acceptance, attachment paths, and transcript continuation.

use serde_json::{Value, json};

use crate::call::Call;
use crate::client::Dispatch;
use crate::error::{Error, ErrorResultExt, InputError, Result};

use super::fixtures::{TOKEN, accepted, client, decode, message, response, transcript};

#[tokio::test]
async fn preserves_attachment_paths_and_normalizes_legacy_paths() -> Result<()> {
    let attachment = json!({"id":"with-path", "name":"notes.md", "kind":"file",
        "mediaType":"text/plain", "sizeBytes":4, "path":"/workspace/.attachments/notes.md"});
    let mut raw = accepted();
    let mut attachments = vec![attachment.clone(); 4];
    attachments[1]
        .as_object_mut()
        .ok_or(Error::Input(InputError::Object))?
        .remove("path");
    attachments[2]["path"] = Value::Null;
    attachments[3]["path"] = json!(42);
    raw["message"]["attachments"] = json!(attachments);
    for call in [
        Call::CreateSession("current".into(), decode(json!({"firstMessage":"Work"}))?),
        Call::SendMessage(
            "current".into(),
            "session".into(),
            decode(json!({"text":"Work"}))?,
        ),
    ] {
        let reply = client(Ok(response(raw.clone())))?.execute(call).await?;
        let value = serde_json::to_value(reply).internal()?;
        let paths: Vec<_> = value["message"]["attachments"]
            .as_array()
            .ok_or(Error::Input(InputError::Object))?
            .iter()
            .map(|attachment| attachment["path"].clone())
            .collect();
        assert_eq!(
            paths,
            vec![
                json!("/workspace/.attachments/notes.md"),
                Value::Null,
                Value::Null,
                Value::Null
            ]
        );
    }
    Ok(())
}

#[tokio::test]
async fn keeps_empty_creation_but_rejects_unpaired_and_empty_send_acceptance() -> Result<()> {
    let mut raw = accepted();
    raw["message"] = Value::Null;
    raw["turnId"] = Value::Null;
    raw["session"]["secret"] = json!(TOKEN);
    raw["workspace"]["repositoryId"] = json!("private-repository");
    let reply = client(Ok(response(raw.clone())))?
        .execute(Call::CreateSession("current".into(), decode(json!({}))?))
        .await?;
    let value = serde_json::to_value(reply).internal()?;
    assert_eq!(
        (
            value["message"].clone(),
            value["turnId"].clone(),
            value["eventNumber"].clone()
        ),
        (Value::Null, Value::Null, json!(7))
    );
    assert_eq!(
        value["resume"],
        json!({"state":"failed", "error":{"code":"start_failed", "message":"Try the start again."}})
    );
    assert_eq!(
        (
            value["session"]["title"].clone(),
            value["session"]["startedBy"].clone()
        ),
        (Value::Null, Value::Null)
    );
    assert!(value["session"].get("secret").is_none());
    assert!(value["workspace"].get("repositoryId").is_none());

    let error = client(Ok(response(raw.clone())))?
        .execute(Call::SendMessage(
            "current".into(),
            "session".into(),
            decode(json!({"text":"Work"}))?,
        ))
        .await
        .err()
        .ok_or(Error::Reply { mac: false })?;
    assert!(matches!(error, Error::Reply { mac: false }));
    for (accepted_message, turn_id) in [(Value::Null, json!("turn")), (message(), Value::Null)] {
        raw["message"] = accepted_message;
        raw["turnId"] = turn_id;
        let error = client(Ok(response(raw.clone())))?
            .execute(Call::CreateSession("current".into(), decode(json!({}))?))
            .await
            .err()
            .ok_or(Error::Reply { mac: false })?;
        assert!(matches!(error, Error::Reply { mac: false }));
    }
    let value = serde_json::to_value(
        client(Ok(response(accepted())))?
            .execute(Call::SendMessage(
                "current".into(),
                "session".into(),
                decode(json!({"text":"Work"}))?,
            ))
            .await?,
    )
    .internal()?;
    assert_eq!(
        (
            value["message"]["id"].clone(),
            value["turnId"].clone(),
            value["session"]["link"].clone()
        ),
        (
            json!("ask"),
            json!("accepted-turn"),
            json!("https://app.conductive.test/org/workspace/session")
        )
    );
    Ok(())
}

#[tokio::test]
async fn keeps_transcript_continuation_and_drops_unknown_fields() -> Result<()> {
    let mut raw = transcript();
    raw["secret"] = json!(TOKEN);
    let reply = client(Ok(response(raw)))?
        .execute(Call::ReadSession(
            "current".into(),
            "session".into(),
            decode(json!({"detail":"full", "startLine":2,"startOffset":0}))?,
        ))
        .await?;
    assert_eq!(serde_json::to_value(reply).internal()?, transcript());
    Ok(())
}

#[tokio::test]
async fn lists_model_fast_marks_and_defaults_older_choices_to_standard() -> Result<()> {
    let raw = json!({
        "models":[
            {"agent":"claude","model":"fast-model","label":"Fast model","efforts":["high"],"fast":true},
            {"agent":"codex","model":"standard-model","label":"Standard model","efforts":["high"]}
        ],
        "defaultChoice":{"agent":"codex","model":"standard-model","effort":"high"}
    });
    let reply = client(Ok(response(raw)))?.execute(Call::ListModels).await?;
    assert_eq!(
        serde_json::to_value(reply).internal()?,
        json!({
            "models":[
                {"agent":"claude","model":"fast-model","label":"Fast model","efforts":["high"],"fast":true},
                {"agent":"codex","model":"standard-model","label":"Standard model","efforts":["high"],"fast":false}
            ],
            "defaultChoice":{"agent":"codex","model":"standard-model","effort":"high","fast":false}
        })
    );
    Ok(())
}
