//! List filters and transcript positions with JavaScript safe-integer bounds.

use serde_json::{Map, Value};

use cnd_runner_interface::tools::session_reads::{
    AgentListSessionsRequest, AgentReadSessionRequest,
};
use cnd_runner_interface::tools::workspaces::AgentListWorkspacesRequest;

use crate::error::{Error, InputError, Result};

use super::parse::{decode, text};

const SAFE: f64 = 9_007_199_254_740_991.0;

fn integer(value: &Value, minimum: f64, maximum: f64, error: InputError) -> Result<()> {
    match value.as_f64() {
        Some(value)
            if value.is_finite()
                && value.fract() == 0.0
                && value >= minimum
                && value <= maximum =>
        {
            Ok(())
        }
        _ => Err(Error::Input(error)),
    }
}

fn page(fields: &Map<String, Value>) -> Result<Map<String, Value>> {
    let mut parsed = Map::new();
    for (key, min, max) in [("limit", 1.0, 100.0), ("offset", 0.0, SAFE)] {
        if let Some(value) = fields.get(key) {
            integer(value, min, max, InputError::List)?;
            parsed.insert(key.into(), value.clone());
        }
    }
    Ok(parsed)
}

pub(super) fn sessions(fields: &Map<String, Value>) -> Result<AgentListSessionsRequest> {
    decode(page(fields)?)
}

pub(super) fn workspaces(fields: &Map<String, Value>) -> Result<AgentListWorkspacesRequest> {
    let mut parsed = page(fields)?;
    for key in ["ownerId", "repositoryId"] {
        if fields.contains_key(key) {
            parsed.insert(key.into(), Value::String(text(fields, key)?));
        }
    }
    if let Some(value) = fields.get("state") {
        if !matches!(
            value.as_str(),
            Some(
                "working"
                    | "input"
                    | "unread"
                    | "ready"
                    | "starting"
                    | "stopped"
                    | "error"
                    | "archived"
            )
        ) {
            return Err(Error::Input(InputError::State));
        }
        parsed.insert("state".into(), value.clone());
    }
    for (key, valid, error) in [
        (
            "archived",
            fields.get("archived").is_none_or(Value::is_boolean),
            InputError::Archived,
        ),
        (
            "query",
            fields.get("query").is_none_or(Value::is_string),
            InputError::Query,
        ),
    ] {
        if !valid {
            return Err(Error::Input(error));
        }
        if let Some(value) = fields.get(key) {
            parsed.insert(key.into(), value.clone());
        }
    }
    if let Some(value) = fields.get("updatedSince") {
        integer(value, -SAFE, SAFE, InputError::List)?;
        parsed.insert("updatedSince".into(), value.clone());
    }
    decode(parsed)
}

pub(super) fn transcript(fields: &Map<String, Value>) -> Result<AgentReadSessionRequest> {
    let mut parsed = Map::new();
    if let Some(value) = fields.get("detail") {
        if !matches!(value.as_str(), Some("concise" | "full")) {
            return Err(Error::Input(InputError::Detail));
        }
        parsed.insert("detail".into(), value.clone());
    }
    for key in ["startLine", "startOffset"] {
        if let Some(value) = fields.get(key) {
            integer(value, 0.0, SAFE, InputError::Position)?;
            parsed.insert(key.into(), value.clone());
        }
    }
    decode(parsed)
}
