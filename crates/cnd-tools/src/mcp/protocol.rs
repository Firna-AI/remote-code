//! Validate protocol messages before any tool can run.

use serde_json::{Map, Value};

use cnd_runner_interface::json::decoder;

use crate::call::Name;
use crate::schema;

use super::PROTOCOL_VERSION;
pub(crate) use super::wire::Response;
use super::wire::{Capabilities, Empty, Id, Info, Initialized, Success};

pub(super) enum Phase {
    New,
    Initialized,
    Ready,
}
pub(super) enum Action {
    Immediate(Option<Response>),
    Tool {
        id: Id,
        name: Name,
        fields: Map<String, Value>,
    },
}

fn error(id: Option<Id>, code: i32, message: &'static str) -> Action {
    Action::Immediate(Some(Response::error(id, code, message)))
}
fn success(id: Id, result: Success) -> Action {
    Action::Immediate(Some(Response::success(id, result)))
}

pub(super) fn prepare(line: &str, phase: &mut Phase) -> Action {
    let value: Value = match decoder::decode(line.as_bytes()) {
        Ok(value) => value,
        Err(_) => return error(None, -32700, "Invalid JSON."),
    };
    let Some(fields) = value.as_object() else {
        return error(None, -32600, "Invalid JSON-RPC request.");
    };
    let id = match Id::from_line(line) {
        Ok(id) => id,
        Err(_) => return error(None, -32700, "Invalid JSON."),
    };
    if fields.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || !fields.get("method").is_some_and(Value::is_string)
        || (fields.contains_key("id") && id.is_none())
    {
        return error(id, -32600, "Invalid JSON-RPC request.");
    }
    let method = fields["method"].as_str().unwrap_or_default();
    let Some(id) = id else {
        if method == "notifications/initialized"
            && matches!(phase, Phase::Initialized | Phase::Ready)
        {
            *phase = Phase::Ready;
        }
        return Action::Immediate(None);
    };
    let params = match fields.get("params") {
        Some(Value::Object(params)) => Some(params),
        None => None,
        _ => return error(Some(id), -32602, "Invalid request parameters."),
    };
    if method == "initialize" {
        let Some(params) = params else {
            return error(Some(id), -32602, "Invalid request parameters.");
        };
        let info = params.get("clientInfo").and_then(Value::as_object);
        if !params.get("protocolVersion").is_some_and(Value::is_string)
            || !params.get("capabilities").is_some_and(Value::is_object)
            || info.is_none_or(|info| {
                !info.get("name").is_some_and(Value::is_string)
                    || !info.get("version").is_some_and(Value::is_string)
            })
        {
            return error(Some(id), -32602, "Invalid request parameters.");
        }
        *phase = Phase::Initialized;
        return success(
            id,
            Success::Initialize(Initialized {
                protocol_version: PROTOCOL_VERSION,
                capabilities: Capabilities { tools: Empty {} },
                server_info: Info {
                    name: "conductive-workspaces",
                    version: "1.0.0",
                },
            }),
        );
    }
    if method == "ping" {
        return success(id, Success::Empty(Empty {}));
    }
    if !matches!(phase, Phase::Ready) {
        return error(Some(id), -32600, "Initialize the workspace tools first.");
    }
    if method == "tools/list" {
        return match schema::tools() {
            Ok(tools) => success(id, Success::Tools { tools }),
            Err(_) => error(Some(id), -32603, "The request failed."),
        };
    }
    if method != "tools/call" {
        return error(Some(id), -32601, "Method not found.");
    }
    let Some(params) = params else {
        return error(Some(id), -32602, "Invalid request parameters.");
    };
    let Some(Value::String(name)) = params.get("name") else {
        return error(Some(id), -32602, "Choose a workspace tool.");
    };
    let name = match serde_json::from_value::<Name>(Value::String(name.clone())) {
        Ok(name) => name,
        Err(_) => return error(Some(id), -32602, "Unknown workspace tool."),
    };
    let fields = match params.get("arguments") {
        Some(Value::Object(fields)) => fields.clone(),
        None => Map::new(),
        _ => return error(Some(id), -32602, "Invalid request parameters."),
    };
    Action::Tool { id, name, fields }
}
