//! Untrusted tool fields become validated typed calls without IO.

use std::mem::discriminant;

use serde_json::{Value, json};

use crate::call::{Call, Name};
use crate::error::{Error, ErrorResultExt, InputError, Result};

use super::parse;

fn parsed(name: Name, fields: Value) -> Result<Call> {
    parse(
        name,
        fields.as_object().ok_or(Error::Input(InputError::Object))?,
        "generated-id",
    )
}

fn body(call: Call) -> Result<Value> {
    Ok(match call {
        Call::CreateWorkspace(input) => serde_json::to_value(input).internal()?,
        Call::CreateSession(_, input) => serde_json::to_value(input).internal()?,
        Call::SendMessage(_, _, input) => serde_json::to_value(input).internal()?,
        Call::RunMacCommand(input) => serde_json::to_value(input).internal()?,
        Call::ListWorkspaces(input) => serde_json::to_value(input).internal()?,
        Call::ReadSession(_, _, input) => serde_json::to_value(input).internal()?,
        _ => return Err(Error::Input(InputError::Object)),
    })
}

fn input_error(name: Name, fields: Value, expected: InputError) -> Result<()> {
    let error = parsed(name, fields.clone())
        .err()
        .ok_or(Error::Reply { mac: false })?;
    let Error::Input(actual) = error else {
        return Err(error);
    };
    assert_eq!(
        discriminant(&actual),
        discriminant(&expected),
        "{name:?}, {fields}: {actual:?}"
    );
    Ok(())
}

#[test]
fn preserves_exact_write_text_and_generates_only_missing_request_ids() -> Result<()> {
    for (name, fields, expected) in [
        (
            Name::CreateWorkspace,
            json!({"repositoryId":"repo", "firstMessage":"  -Work\nNext  ",
            "firstSessionTitle":"", "name":"", "model":{"agent":"claude", "model":"model", "secret":"ignored"},
            "effort":"max", "fast":true, "sectionId":"section", "sender":"ignored"}),
            json!({"repositoryId":"repo", "firstMessage":"  -Work\nNext  ", "firstSessionTitle":"", "name":"",
                "model":{"agent":"claude", "model":"model"}, "effort":"max", "fast":true, "sectionId":"section", "requestId":"generated-id"}),
        ),
        (
            Name::CreateSession,
            json!({"workspaceId":"other", "title":"", "firstMessage":"  Hi  ", "fast":false, "requestId":"retry"}),
            json!({"title":"", "firstMessage":"  Hi  ", "fast":false, "requestId":"retry"}),
        ),
        (
            Name::SendMessage,
            json!({"sessionId":"session", "text":"  -text\r\n  ", "effort":"high"}),
            json!({"text":"  -text\r\n  ", "effort":"high", "requestId":"generated-id"}),
        ),
        (
            Name::RunMacCommand,
            json!({"command":"  pwd\n", "folder":" /tmp ", "reason":" Check ", "sender":"ignored"}),
            json!({"command":"  pwd\n", "folder":" /tmp ", "reason":" Check ", "timeoutSeconds":60,"requestId":"generated-id"}),
        ),
    ] {
        assert_eq!(
            body(parsed(name, fields).internal()?)?,
            expected,
            "{name:?}"
        );
    }
    let call = parsed(Name::GetWorkspace, json!({})).internal()?;
    let Call::GetWorkspace(workspace) = call else {
        return Err(Error::Input(InputError::Object));
    };
    assert_eq!(workspace, "current");
    Ok(())
}

#[test]
fn rejects_invalid_shared_write_and_resource_fields() -> Result<()> {
    for (name, fields, expected) in [
        (
            Name::CreateWorkspace,
            json!({"repositoryId":"repo", "firstMessage":" "}),
            InputError::Required,
        ),
        (
            Name::CreateSession,
            json!({"requestId":""}),
            InputError::RequestId,
        ),
        (Name::CreateSession, json!({"model":[]}), InputError::Object),
        (
            Name::CreateSession,
            json!({"model":{"agent":"other", "model":"model"}}),
            InputError::Agent,
        ),
        (
            Name::CreateSession,
            json!({"model":{"agent":"codex", "model":" "}}),
            InputError::Required,
        ),
        (
            Name::SendMessage,
            json!({"sessionId":"session", "text":"Work", "effort":"invalid"}),
            InputError::Effort,
        ),
        (
            Name::GetSession,
            json!({"sessionId":" "}),
            InputError::Required,
        ),
        (
            Name::GetWorkspace,
            json!({"workspaceId":false}),
            InputError::Required,
        ),
        (
            Name::CloseSession,
            json!({"sessionId":"session", "stopRunningTurn":"true"}),
            InputError::Close,
        ),
        (Name::OpenPreview, json!({"port":0}), InputError::Port),
        (Name::OpenPreview, json!({"port":65536}), InputError::Port),
        (Name::OpenPreview, json!({"port":2.5}), InputError::Port),
    ] {
        input_error(name, fields, expected)?;
    }
    Ok(())
}

#[test]
fn preserves_list_filters_and_safe_transcript_boundaries() -> Result<()> {
    let filters = json!({"ownerId":"member", "repositoryId":"repo", "state":"ready", "query":"", "updatedSince":-1,
        "archived":false, "limit":100, "offset":9007199254740991u64});
    assert_eq!(
        body(parsed(Name::ListWorkspaces, filters.clone()).internal()?)?,
        filters
    );
    let integral = parsed(
        Name::ListWorkspaces,
        json!({"limit":100.0,"offset":0.0,"updatedSince":-1.0}),
    );
    assert!(
        integral.is_ok(),
        "JSON integral numbers must pass: {integral:?}"
    );
    assert_eq!(
        body(integral?)?,
        json!({"limit":100,"offset":0,"updatedSince":-1})
    );
    let preview = parsed(Name::OpenPreview, json!({"port":3000.0}));
    assert!(matches!(preview, Ok(Call::OpenPreview(_, input)) if input.port == 3000));
    let positions = json!({"detail":"full", "startLine":0,"startOffset":9007199254740991u64});
    let mut fields = positions.clone();
    fields["sessionId"] = json!("session");
    assert_eq!(
        body(parsed(Name::ReadSession, fields).internal()?)?,
        positions
    );
    Ok(())
}

#[test]
fn rejects_invalid_filters_and_transcript_positions() -> Result<()> {
    for (name, fields, expected) in [
        (Name::ListWorkspaces, json!({"limit":0}), InputError::List),
        (Name::ListSessions, json!({"limit":101}), InputError::List),
        (Name::ListSessions, json!({"offset":-1}), InputError::List),
        (
            Name::ListWorkspaces,
            json!({"offset":9007199254740992u64}),
            InputError::List,
        ),
        (
            Name::ListWorkspaces,
            json!({"updatedSince":9007199254740992u64}),
            InputError::List,
        ),
        (
            Name::ListWorkspaces,
            json!({"archived":"false"}),
            InputError::Archived,
        ),
        (Name::ListWorkspaces, json!({"query":7}), InputError::Query),
        (
            Name::ListWorkspaces,
            json!({"state":"unknown"}),
            InputError::State,
        ),
        (
            Name::ReadSession,
            json!({"sessionId":"session", "detail":"unknown"}),
            InputError::Detail,
        ),
        (
            Name::ReadSession,
            json!({"sessionId":"session", "startLine":-1}),
            InputError::Position,
        ),
        (
            Name::ReadSession,
            json!({"sessionId":"session", "startOffset":0.5}),
            InputError::Position,
        ),
        (
            Name::ReadSession,
            json!({"sessionId":"session", "startOffset":9007199254740992u64}),
            InputError::Position,
        ),
    ] {
        input_error(name, fields, expected)?;
    }
    Ok(())
}

#[test]
fn validates_mac_timeout_reasons_and_required_fields() -> Result<()> {
    let base = json!({"command":"pwd", "folder":"/tmp", "reason":"Check"});
    for (field, value, expected) in [
        ("command", json!(" "), InputError::MacFields),
        ("folder", Value::Null, InputError::MacFields),
        ("reason", json!(false), InputError::MacFields),
        ("requestId", json!(""), InputError::MacFields),
        ("timeoutSeconds", json!("60"), InputError::MacNumber),
        ("timeoutSeconds", json!(0), InputError::MacTimeout),
        ("timeoutSeconds", json!(1801), InputError::MacTimeout),
        ("timeoutSeconds", json!(0.5), InputError::MacTimeout),
        ("timeoutSeconds", json!(121), InputError::MacReason),
        ("longerTimeoutReason", json!(5), InputError::MacFields),
    ] {
        let mut fields = base.clone();
        fields[field] = value;
        input_error(Name::RunMacCommand, fields, expected)?;
    }
    for timeout in [1, 120, 1800] {
        let mut fields = base.clone();
        fields["timeoutSeconds"] = json!(f64::from(timeout));
        fields["longerTimeoutReason"] = json!(" Long task ");
        let value = body(parsed(Name::RunMacCommand, fields).internal()?)?;
        assert_eq!(
            (
                value["timeoutSeconds"].clone(),
                value["longerTimeoutReason"].clone()
            ),
            (json!(timeout), json!(" Long task "))
        );
    }
    Ok(())
}
