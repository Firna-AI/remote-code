//! Workspace records returned by the workspace tools.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::AgentChoice;
use crate::api::Timestamp;
use crate::messages::MessageSender;

/// Workspace activity; input means the agent waits for a user action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum WorkspaceState {
    /// working.
    #[serde(rename = "working")]
    Working,
    /// input.
    #[serde(rename = "input")]
    Input,
    /// unread.
    #[serde(rename = "unread")]
    Unread,
    /// ready.
    #[serde(rename = "ready")]
    Ready,
    /// starting.
    #[serde(rename = "starting")]
    Starting,
    /// stopped.
    #[serde(rename = "stopped")]
    Stopped,
    /// error.
    #[serde(rename = "error")]
    Error,
    /// archived.
    #[serde(rename = "archived")]
    Archived,
}

/// The pull request bar state shown in a workspace list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum GitHubSummary {
    /// checks-running.
    #[serde(rename = "checks-running")]
    ChecksRunning,
    /// checks-failed.
    #[serde(rename = "checks-failed")]
    ChecksFailed,
    /// ready-to-merge.
    #[serde(rename = "ready-to-merge")]
    ReadyToMerge,
    /// merged.
    #[serde(rename = "merged")]
    Merged,
    /// conflict.
    #[serde(rename = "conflict")]
    Conflict,
    /// changes-requested.
    #[serde(rename = "changes-requested")]
    ChangesRequested,
    /// draft.
    #[serde(rename = "draft")]
    Draft,
    /// blocked.
    #[serde(rename = "blocked")]
    Blocked,
}

/// The complete workspace record returned by creation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    /// id.
    pub id: String,
    /// number.
    pub number: u64,
    /// link.
    pub link: String,
    /// org id.
    pub org_id: String,
    /// repository id.
    pub repository_id: String,
    /// section id.
    pub section_id: String,
    /// owner.
    pub owner: MessageSender,
    /// name.
    pub name: Option<String>,
    /// branch.
    pub branch: String,
    /// choice.
    pub choice: AgentChoice,
    /// state.
    pub state: WorkspaceState,
    /// github.
    pub github: Option<GitHubSummary>,
    /// created at.
    pub created_at: Timestamp,
    /// updated at.
    pub updated_at: Timestamp,
    /// archived at.
    pub archived_at: Option<Timestamp>,
    /// restore until.
    pub restore_until: Option<Timestamp>,
}
