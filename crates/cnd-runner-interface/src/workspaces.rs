//! Workspaces wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::api::Timestamp;
use crate::wire::ReadonlyVec;

/// WorkspaceStartKind wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum WorkspaceStartKind {
    /// create.
    #[serde(rename = "create")]
    Create,
    /// resume.
    #[serde(rename = "resume")]
    Resume,
}

/// WorkspaceStart wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStart {
    /// kind.
    pub kind: WorkspaceStartKind,
    /// startedAt.
    pub started_at: Timestamp,
    /// steps.
    #[ts(as = "ReadonlyVec<StartStep>")]
    pub steps: Vec<StartStep>,
}

/// StartStepState wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum StartStepState {
    /// running.
    #[serde(rename = "running")]
    Running,
    /// completed.
    #[serde(rename = "completed")]
    Completed,
    /// failed.
    #[serde(rename = "failed")]
    Failed,
}

/// StartStep wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StartStep {
    /// id.
    pub id: String,
    /// label.
    pub label: String,
    /// state.
    pub state: StartStepState,
    /// startedAt.
    pub started_at: Timestamp,
    /// completedAt.
    pub completed_at: Option<Timestamp>,
}
