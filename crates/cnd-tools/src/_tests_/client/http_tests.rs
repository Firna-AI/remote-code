//! Response sanitization, refusal details, and safe request construction.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::{Value, json};
use unimock::{MockFn, Unimock, matching};

use crate::call::Call;
use crate::client::Dispatch;
use crate::error::{Error, ErrorResultExt, InputError, Result};
use crate::ports::{HttpMock, HttpRequest, HttpResponse};

use super::fixtures::{
    TOKEN, TURN, accepted, client, configured, decode, list_call, listed_workspaces, response,
    route,
};
use super::request_cases::cases;

#[tokio::test]
async fn drops_unknown_fields_and_rejects_malformed_workspaces() -> Result<()> {
    let mut raw = listed_workspaces();
    raw["secret"] = json!(TOKEN);
    raw["extra"] = json!({"id":""});
    raw["workspaces"][0]["ciphertext"] = json!("encrypted-secret");
    let reply = client(Ok(response(raw)))?.execute(list_call()?).await;
    assert_eq!(
        serde_json::to_value(reply?).internal()?,
        listed_workspaces()
    );

    let mut malformed = listed_workspaces();
    malformed["workspaces"][0]["state"] = json!("unknown");
    let error = client(Ok(response(malformed)))?
        .execute(list_call()?)
        .await
        .err()
        .ok_or(Error::Reply { mac: false })?;
    assert!(matches!(error, Error::Reply { mac: false }));
    assert_eq!(
        error.message(),
        "The workspace reply is not valid. Try again."
    );
    Ok(())
}

#[tokio::test]
async fn rejects_missing_required_nullable_response_fields() -> Result<()> {
    let mut raw = listed_workspaces();
    raw["workspaces"][0]["owner"]
        .as_object_mut()
        .ok_or(Error::Input(InputError::Object))?
        .remove("displayName");
    let result = client(Ok(response(raw)))?.execute(list_call()?).await;
    assert!(matches!(result, Err(Error::Reply { mac: false })));
    Ok(())
}

#[tokio::test]
async fn hides_transport_details_and_opaque_server_bodies() -> Result<()> {
    let cases = [
        (
            Err(Error::Worker {
                status: 502,
                code: TOKEN.into(),
                message: TOKEN.into(),
            }),
            "The workspace request failed. Try again.",
        ),
        (
            Ok(HttpResponse {
                status: 500,
                body: json!({"error":{"message":TOKEN}}).to_string(),
            }),
            "The workspace request failed. Check its fields and try again.",
        ),
        (
            Ok(HttpResponse {
                status: 200,
                body: TOKEN.into(),
            }),
            "The workspace reply is not valid. Try again.",
        ),
        (
            Ok(HttpResponse {
                status: 401,
                body: TOKEN.into(),
            }),
            "The workspace login is not valid. Start the workspace again.",
        ),
    ];
    for (response, message) in cases {
        let error = client(response)?
            .execute(list_call()?)
            .await
            .err()
            .ok_or(Error::Reply { mac: false })?;
        assert_eq!(error.message(), message);
        assert!(!format!("{error:?}").contains(TOKEN));
    }
    Ok(())
}

#[tokio::test]
async fn keeps_redacted_worker_refusals_for_all_24_calls() -> Result<()> {
    let calls = cases()?;
    assert_eq!(calls.len(), 24);
    for case in calls {
        let name = case.call.name();
        let call = case.call;
        let body = json!({"error":{
            "code":format!("membership_required-{TOKEN}"),
            "message":format!("Access ended for {TOKEN}. {TOKEN}"),
            "details":{"private":TOKEN}
        }});
        let answer = move |_: &Unimock, request: HttpRequest| {
            let url = reqwest::Url::parse(&request.url).internal()?;
            assert_eq!(
                url.as_str()
                    .split('?')
                    .next()
                    .ok_or(Error::Reply { mac: false })?,
                route(case.path),
                "{name:?}"
            );
            let query: serde_json::Map<String, Value> = url
                .query_pairs()
                .into_owned()
                .map(|(key, value)| (key, Value::String(value)))
                .collect();
            assert_eq!(Value::Object(query), case.query, "{name:?}");
            assert_eq!(
                (request.token.as_str(), request.turn_id.as_deref()),
                (TOKEN, Some(TURN)),
                "{name:?}"
            );
            assert_eq!(
                request
                    .body
                    .map(|body| serde_json::from_str::<Value>(&body))
                    .transpose()
                    .internal()?,
                case.body,
                "{name:?}"
            );
            Ok(HttpResponse {
                status: 403,
                body: body.to_string(),
            })
        };
        let http = Unimock::new(
            HttpMock::send
                .some_call(matching!(_))
                .answers_arc(Arc::new(answer)),
        );
        let error = configured(http, Unimock::new(()), Some(TURN))?
            .execute(call)
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
                "membership_required-[redacted]",
                "Access ended for [redacted]. [redacted]"
            ),
            "{name:?}"
        );
    }
    Ok(())
}

#[tokio::test]
async fn encodes_route_ids_and_preserves_message_and_list_fields() -> Result<()> {
    let http = Unimock::new(
        HttpMock::send
            .some_call(matching!(_))
            .answers(&|_, request| {
                assert_eq!(
                    request.url,
                    route(&[
                        "workspaces",
                        "team%2Fa%3F%25",
                        "sessions",
                        "a%20b%2F%23",
                        "messages"
                    ])
                );
                assert_eq!(
                    (request.token.as_str(), request.turn_id.as_deref()),
                    (TOKEN, Some(TURN))
                );
                assert_eq!(
                    serde_json::from_str::<Value>(
                        request.body.as_deref().ok_or(Error::Reply { mac: false })?
                    )
                    .internal()?,
                    json!({"requestId":"retry", "text":"  -first\nsecond  "})
                );
                Ok(response(accepted()))
            }),
    );
    let reply = configured(http, Unimock::new(()), Some(TURN))?
        .execute(Call::SendMessage(
            "team/a?%".into(),
            "a b/#".into(),
            decode(json!({"requestId":"retry", "text":"  -first\nsecond  "}))?,
        ))
        .await?;
    assert!(!reply.failed());

    let http = Unimock::new(
        HttpMock::send
            .some_call(matching!(_))
            .answers(&|_, request| {
                let url = reqwest::Url::parse(&request.url).internal()?;
                assert_eq!(
                    url.origin().ascii_serialization(),
                    "https://machine.conductive.test"
                );
                assert_eq!(url.path(), "/v1/tools/workspaces");
                let query: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
                assert_eq!(
                    query,
                    BTreeMap::from([
                        ("archived".into(), "false".into()),
                        ("offset".into(), "0".into()),
                        ("query".into(), "  a&b?  ".into()),
                        ("updatedSince".into(), "-1".into()),
                    ])
                );
                assert!(request.body.is_none());
                Ok(response(listed_workspaces()))
            }),
    );
    let reply = configured(http, Unimock::new(()), None)?
        .execute(Call::ListWorkspaces(decode(
            json!({"archived":false,"offset":0,"query":"  a&b?  ","updatedSince":-1}),
        )?))
        .await?;
    assert_eq!(serde_json::to_value(reply).internal()?, listed_workspaces());
    Ok(())
}
