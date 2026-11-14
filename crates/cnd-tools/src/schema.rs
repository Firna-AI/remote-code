//! Preserved MCP descriptors and typed JSON Schema vocabulary.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{ErrorResultExt, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Descriptor {
    pub(crate) name: String,
    description: String,
    input_schema: Schema,
    annotations: Annotations,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Annotations {
    read_only_hint: bool,
    destructive_hint: bool,
    idempotent_hint: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum Literal {
    Text(String),
    Integer(i64),
    Flag(bool),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Schema {
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    properties: Option<BTreeMap<String, Schema>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    required: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    minimum: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    maximum: Option<i64>,
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    values: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default: Option<Literal>,
}

pub(crate) fn tools() -> Result<Vec<Descriptor>> {
    serde_json::from_str(include_str!("mcp-tools.json")).internal()
}
