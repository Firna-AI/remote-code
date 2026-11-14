//! JSON-RPC envelopes and typed MCP result bodies.

use std::fmt;

use serde::de::{IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Number, value::RawValue};

use crate::reply::Reply;
use crate::schema::Descriptor;

/// An accepted request ID, kept as its original JSON token for every reply.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub(super) struct Id(Box<RawValue>);

impl Id {
    pub(super) fn from_line(line: &str) -> serde_json::Result<Option<Self>> {
        let mut deserializer = serde_json::Deserializer::from_str(line);
        let raw = deserializer.deserialize_map(RequestId)?;
        deserializer.end()?;
        Ok(raw
            .filter(|raw| {
                raw.get().starts_with('"')
                    || serde_json::from_str::<Number>(raw.get())
                        .ok()
                        .and_then(|number| number.as_f64())
                        .is_some_and(|number| number.is_finite() && number.fract() == 0.0)
            })
            .map(Self))
    }
}

/// Read the last top-level ID without decoding its string value.
struct RequestId;

impl<'de> Visitor<'de> for RequestId {
    type Value = Option<Box<RawValue>>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON-RPC request object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut id = None;
        while let Some(key) = map.next_key::<IdKey>()? {
            if key.0 {
                id = Some(map.next_value()?);
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(id)
    }
}

/// Match the ID key while accepting lone surrogates in unrelated keys.
struct IdKey(bool);
struct IdKeyVisitor;

impl<'de> Deserialize<'de> for IdKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_bytes(IdKeyVisitor)
    }
}

impl<'de> Visitor<'de> for IdKeyVisitor {
    type Value = IdKey;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an object key")
    }

    fn visit_bytes<E: serde::de::Error>(self, bytes: &[u8]) -> Result<Self::Value, E> {
        Ok(IdKey(bytes == b"id"))
    }
}

#[derive(Serialize)]
pub(crate) struct Response {
    jsonrpc: &'static str,
    id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Success>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Serialize)]
struct RpcError {
    code: i32,
    message: &'static str,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum Success {
    Initialize(Initialized),
    Empty(Empty),
    Tools { tools: Vec<Descriptor> },
    Tool(Box<ToolResult>),
}
#[derive(Serialize)]
pub(super) struct Empty {}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Initialized {
    pub(super) protocol_version: &'static str,
    pub(super) capabilities: Capabilities,
    pub(super) server_info: Info,
}
#[derive(Serialize)]
pub(super) struct Capabilities {
    pub(super) tools: Empty,
}
#[derive(Serialize)]
pub(super) struct Info {
    pub(super) name: &'static str,
    pub(super) version: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolResult {
    content: Vec<Text>,
    #[serde(skip_serializing_if = "Option::is_none")]
    structured_content: Option<Reply>,
    is_error: bool,
}
#[derive(Serialize)]
struct Text {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
}

impl Response {
    pub(super) fn error(id: Option<Id>, code: i32, message: &'static str) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError { code, message }),
        }
    }
    pub(super) fn success(id: Id, result: Success) -> Self {
        Self {
            jsonrpc: "2.0",
            id: Some(id),
            result: Some(result),
            error: None,
        }
    }
    pub(crate) fn tool(id: Id, reply: Reply) -> Self {
        let text = match serde_json::to_string(&reply) {
            Ok(text) => text,
            Err(_) => return Self::error(Some(id), -32603, "The request failed."),
        };
        Self::success(
            id,
            Success::Tool(Box::new(ToolResult {
                content: vec![Text { kind: "text", text }],
                is_error: reply.failed(),
                structured_content: Some(reply),
            })),
        )
    }
    pub(crate) fn tool_error(id: Id, message: String) -> Self {
        Self::success(
            id,
            Success::Tool(Box::new(ToolResult {
                content: vec![Text {
                    kind: "text",
                    text: message,
                }],
                structured_content: None,
                is_error: true,
            })),
        )
    }
}
