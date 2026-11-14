//! Preview records and workspace preview tool replies.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::api::Timestamp;
use crate::wire::ReadonlyVec;

use super::workspaces::AgentWorkspaceSummary;

/// OpenPreviewRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OpenPreviewRequest {
    /// port.
    pub port: u16,
}

/// Preview wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// New for each open; revoked IDs are never reused.
    pub id: String,
    /// port.
    pub port: u16,
    /// Authenticated app launch URL; each navigation grants browser partition access.
    pub url: String,
    /// expires at.
    pub expires_at: Timestamp,
}

/// AgentListPreviewsResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentListPreviewsResponse {
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// previews.
    #[ts(as = "ReadonlyVec<Preview>")]
    pub previews: Vec<Preview>,
}

/// AgentOpenPreviewResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentOpenPreviewResponse {
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// preview.
    pub preview: Preview,
}

/// AgentClosePreviewResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentClosePreviewResponse {
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// closed.
    pub closed: bool,
}
