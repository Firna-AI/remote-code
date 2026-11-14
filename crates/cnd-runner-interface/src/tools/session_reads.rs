//! Session list and transcript window contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::AgentChoice;
use crate::messages::MessageSender;
use crate::wire::ReadonlyVec;

use super::session_types::{AgentSessionLink, TranscriptDetail};
use super::workspaces::AgentWorkspaceSummary;

/// AgentSessionState wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum AgentSessionState {
    /// running.
    #[serde(rename = "running")]
    Running,
    /// failed.
    #[serde(rename = "failed")]
    Failed,
    /// idle.
    #[serde(rename = "idle")]
    Idle,
}

/// AgentSessionSummary wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    /// id.
    pub id: String,
    /// link.
    pub link: String,
    /// title.
    pub title: Option<String>,
    /// choice.
    pub choice: AgentChoice,
    /// started by.
    pub started_by: Option<MessageSender>,
    /// state.
    pub state: AgentSessionState,
    /// closed.
    pub closed: bool,
}

/// AgentListSessionsRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentListSessionsRequest {
    /// limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub limit: Option<u64>,
    /// offset.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub offset: Option<u64>,
}

/// AgentListSessionsResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentListSessionsResponse {
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// sessions.
    #[ts(as = "ReadonlyVec<AgentSessionSummary>")]
    pub sessions: Vec<AgentSessionSummary>,
    /// has more.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub has_more: Option<bool>,
}

/// Offsets count UTF-16 code units within the named one-based line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptPosition {
    /// line.
    pub line: u64,
    /// offset.
    pub offset: u64,
}

/// AgentReadSessionRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentReadSessionRequest {
    /// detail.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<TranscriptDetail>,
    /// start line.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_line: Option<u64>,
    /// start offset.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_offset: Option<u64>,
}

/// AgentTranscriptWindow wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptWindow {
    /// markdown.
    pub markdown: String,
    /// start line.
    pub start_line: u64,
    /// end line.
    pub end_line: u64,
    /// total lines.
    pub total_lines: u64,
    /// start offset.
    pub start_offset: u64,
    /// end offset.
    pub end_offset: u64,
    /// next.
    pub next: Option<AgentTranscriptPosition>,
}

/// AgentReadSessionResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentReadSessionResponse {
    /// window.
    #[serde(flatten)]
    pub window: AgentTranscriptWindow,
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// session.
    pub session: AgentSessionLink,
    /// detail.
    pub detail: TranscriptDetail,
}
