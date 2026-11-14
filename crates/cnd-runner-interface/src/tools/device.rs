//! Mac command input and command result records.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::api::Timestamp;

use super::resources::AgentToolFailure;

/// A sandbox cannot choose a sender, owner, device, or host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCommandInput {
    /// request id.
    pub request_id: String,
    /// command.
    pub command: String,
    /// folder.
    pub folder: String,
    /// reason.
    pub reason: String,
    /// timeout seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub timeout_seconds: Option<u32>,
    /// longer timeout reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub longer_timeout_reason: Option<String>,
}

/// DeviceCommandState wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum DeviceCommandState {
    /// waiting.
    #[serde(rename = "waiting")]
    Waiting,
    /// running.
    #[serde(rename = "running")]
    Running,
    /// completed.
    #[serde(rename = "completed")]
    Completed,
    /// denied.
    #[serde(rename = "denied")]
    Denied,
    /// unavailable.
    #[serde(rename = "unavailable")]
    Unavailable,
    /// timed-out.
    #[serde(rename = "timed-out")]
    TimedOut,
    /// failed.
    #[serde(rename = "failed")]
    Failed,
}

/// DeviceCommandResult wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCommandResult {
    /// stdout.
    pub stdout: String,
    /// stderr.
    pub stderr: String,
    /// exit code.
    pub exit_code: Option<i64>,
    /// timed out.
    pub timed_out: bool,
    /// truncated.
    pub truncated: bool,
}

/// DevicePairing wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DevicePairing {
    /// device id.
    pub device_id: String,
    /// connection id.
    pub connection_id: String,
}

/// A device prompt needs identity labels, not the full account record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSender {
    /// id.
    pub id: String,
    /// github login.
    pub github_login: String,
    /// display name.
    pub display_name: Option<String>,
    /// avatar url.
    pub avatar_url: Option<String>,
}

/// DeviceCommandRecord wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCommandRecord {
    /// request id.
    pub request_id: String,
    /// The base64url SHA-256 storage key used in command URLs.
    pub request_key: String,
    /// org id.
    pub org_id: String,
    /// workspace id.
    pub workspace_id: String,
    /// workspace name.
    pub workspace_name: Option<String>,
    /// session id.
    pub session_id: String,
    /// turn id.
    pub turn_id: String,
    /// sender.
    pub sender: DeviceSender,
    /// device.
    pub device: Option<DevicePairing>,
    /// device name.
    pub device_name: Option<String>,
    /// command.
    pub command: String,
    /// folder.
    pub folder: String,
    /// reason.
    pub reason: String,
    /// timeout seconds.
    pub timeout_seconds: u32,
    /// longer timeout reason.
    pub longer_timeout_reason: Option<String>,
    /// state.
    pub state: DeviceCommandState,
    /// result.
    pub result: Option<DeviceCommandResult>,
    /// error.
    pub error: Option<AgentToolFailure>,
    /// created at.
    pub created_at: Timestamp,
    /// started at.
    pub started_at: Option<Timestamp>,
    /// updated at.
    pub updated_at: Timestamp,
}

/// DeviceCommandResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCommandResponse {
    /// request.
    pub request: DeviceCommandRecord,
}
