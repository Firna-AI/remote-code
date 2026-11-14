//! Workspace, session, and Mac write inputs preserve exact text.

use serde_json::{Map, Value};

use cnd_runner_interface::tools::device::DeviceCommandInput;
use cnd_runner_interface::tools::sessions::{AgentCreateSessionRequest, AgentSendMessageRequest};
use cnd_runner_interface::tools::workspaces::AgentCreateWorkspaceRequest;

use crate::error::{Error, InputError, Result};

use super::parse::{decode, text, whole_number};

fn choices(fields: &Map<String, Value>, request_id: &str) -> Result<Map<String, Value>> {
    let mut parsed = Map::new();
    let id = match fields.get("requestId") {
        None => request_id,
        Some(Value::String(value)) if !value.is_empty() => value,
        _ => return Err(Error::Input(InputError::RequestId)),
    };
    parsed.insert("requestId".into(), Value::String(id.into()));
    if let Some(value) = fields.get("model") {
        let Some(model) = value.as_object() else {
            return Err(Error::Input(InputError::Object));
        };
        if !matches!(
            model.get("agent").and_then(Value::as_str),
            Some("claude" | "codex")
        ) {
            return Err(Error::Input(InputError::Agent));
        }
        let mut choice = Map::new();
        choice.insert("agent".into(), model["agent"].clone());
        choice.insert("model".into(), Value::String(text(model, "model")?));
        parsed.insert("model".into(), Value::Object(choice));
    }
    if let Some(value) = fields.get("effort") {
        if !matches!(
            value.as_str(),
            Some("none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra")
        ) {
            return Err(Error::Input(InputError::Effort));
        }
        parsed.insert("effort".into(), value.clone());
    }
    if let Some(value) = fields.get("fast") {
        parsed.insert("fast".into(), Value::Bool(value == &Value::Bool(true)));
    }
    Ok(parsed)
}

pub(super) fn workspace(
    fields: &Map<String, Value>,
    request_id: &str,
) -> Result<AgentCreateWorkspaceRequest> {
    let mut parsed = choices(fields, request_id)?;
    for key in ["repositoryId", "firstMessage"] {
        parsed.insert(key.into(), Value::String(text(fields, key)?));
    }
    for key in ["name", "firstSessionTitle"] {
        if let Some(value) = fields.get(key).filter(|value| value.is_string()) {
            parsed.insert(key.into(), value.clone());
        }
    }
    if fields.contains_key("sectionId") {
        parsed.insert(
            "sectionId".into(),
            Value::String(text(fields, "sectionId")?),
        );
    }
    decode(parsed)
}

pub(super) fn session(
    fields: &Map<String, Value>,
    request_id: &str,
) -> Result<AgentCreateSessionRequest> {
    let mut parsed = choices(fields, request_id)?;
    if let Some(value) = fields.get("title").filter(|value| value.is_string()) {
        parsed.insert("title".into(), value.clone());
    }
    if fields.contains_key("firstMessage") {
        parsed.insert(
            "firstMessage".into(),
            Value::String(text(fields, "firstMessage")?),
        );
    }
    decode(parsed)
}

pub(super) fn send(
    fields: &Map<String, Value>,
    request_id: &str,
) -> Result<AgentSendMessageRequest> {
    let mut parsed = choices(fields, request_id)?;
    parsed.insert("text".into(), Value::String(text(fields, "text")?));
    decode(parsed)
}

pub(super) fn mac(fields: &Map<String, Value>, request_id: &str) -> Result<DeviceCommandInput> {
    let mut parsed = Map::new();
    let timeout = match fields.get("timeoutSeconds") {
        None => 60,
        Some(value) => match whole_number(value) {
            Some(number) if (1..=1800).contains(&number) => number,
            Some(_) => return Err(Error::Input(InputError::MacTimeout)),
            None if value.is_number() => return Err(Error::Input(InputError::MacTimeout)),
            _ => return Err(Error::Input(InputError::MacNumber)),
        },
    };
    parsed.insert("timeoutSeconds".into(), Value::from(timeout));
    if let Some(value) = fields.get("longerTimeoutReason") {
        if !value.is_string() {
            return Err(Error::Input(InputError::MacFields));
        }
        parsed.insert("longerTimeoutReason".into(), value.clone());
    }
    if timeout > 120
        && fields
            .get("longerTimeoutReason")
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty())
    {
        return Err(Error::Input(InputError::MacReason));
    }
    let mut fields = fields.clone();
    fields
        .entry("requestId")
        .or_insert_with(|| Value::String(request_id.into()));
    for key in ["requestId", "command", "folder", "reason"] {
        match fields.get(key).and_then(Value::as_str) {
            Some(value) if !value.trim().is_empty() => {
                parsed.insert(key.into(), Value::String(value.into()));
            }
            _ => return Err(Error::Input(InputError::MacFields)),
        }
    }
    decode(parsed)
}
