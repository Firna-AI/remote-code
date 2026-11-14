//! Session management and message lookup tool contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::api::Timestamp;
use crate::messages::{MessageSender, UserMessageState};

use super::session_reads::AgentSessionSummary;
use super::session_types::AgentSessionLink;
use super::workspaces::AgentWorkspaceSummary;

/// AgentSessionResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionResponse {
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// session.
    pub session: AgentSessionSummary,
}

/// AgentRenameSessionRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentRenameSessionRequest {
    /// title.
    pub title: String,
}

/// AgentCloseSessionRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentCloseSessionRequest {
    /// stop running turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stop_running_turn: Option<bool>,
}

/// AgentStopSessionState wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum AgentStopSessionState {
    /// idle.
    #[serde(rename = "idle")]
    Idle,
    /// stopped.
    #[serde(rename = "stopped")]
    Stopped,
    /// stopping.
    #[serde(rename = "stopping")]
    Stopping,
}

/// AgentStopSessionResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentStopSessionResponse {
    /// response.
    #[serde(flatten)]
    pub response: AgentSessionResponse,
    /// turn id.
    pub turn_id: Option<String>,
    /// state.
    pub state: AgentStopSessionState,
}

/// The message fields returned by the workspace tool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageSummary {
    /// id.
    pub id: String,
    /// session id.
    pub session_id: String,
    /// sender.
    pub sender: MessageSender,
    /// text.
    pub text: String,
    /// state.
    pub state: UserMessageState,
    /// created at.
    pub created_at: Timestamp,
}

/// AgentGetMessageResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentGetMessageResponse {
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// session.
    pub session: AgentSessionLink,
    /// message.
    pub message: AgentMessageSummary,
    /// turn id.
    pub turn_id: Option<String>,
}
