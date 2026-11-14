//! Agents wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// AgentChoice wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentChoice {
    /// agent.
    pub agent: Agent,
    /// model.
    pub model: String,
    /// effort.
    pub effort: Effort,
    /// Whether the choice requests fast mode. Older choices default to standard speed.
    #[serde(default)]
    pub fast: bool,
}

/// Agent wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum Agent {
    /// claude.
    #[serde(rename = "claude")]
    Claude,
    /// codex.
    #[serde(rename = "codex")]
    Codex,
}

/// Effort wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum Effort {
    /// none.
    #[serde(rename = "none")]
    None,
    /// low.
    #[serde(rename = "low")]
    Low,
    /// medium.
    #[serde(rename = "medium")]
    Medium,
    /// high.
    #[serde(rename = "high")]
    High,
    /// xhigh.
    #[serde(rename = "xhigh")]
    Xhigh,
    /// max.
    #[serde(rename = "max")]
    Max,
    /// ultra.
    #[serde(rename = "ultra")]
    Ultra,
}
