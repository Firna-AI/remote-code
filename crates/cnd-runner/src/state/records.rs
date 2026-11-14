//! Typed fields of the existing runner-state.json format.

use cnd_runner_interface::agents::Agent;
use cnd_runner_interface::ports::{PORT_REPORT_MAX_PORTS, RunnerPortsUpdated};
use cnd_runner_interface::runner::{RunnerEvent, RunnerStartUpdated, RunnerWorkspaceTitle};
use cnd_runner_interface::runner_commands::RunnerBranches;
use cnd_runner_interface::runner_handshake::RunnerEventEnvelope;
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::{Error, Result};
use crate::json::codec::{self, MAX_SAFE_INTEGER};

/// State saved in the same JSON object as the Node runner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerState {
    /// Persistent event stream identity.
    pub stream_id: String,
    /// Number assigned to the next accepted event.
    pub next_event_number: u64,
    /// Last contiguous confirmation that has been saved.
    pub confirmed_through: u64,
    /// Unconfirmed events in number order.
    pub outbox: Vec<RunnerEventEnvelope>,
    /// Conversation references and fixed instructions, without credentials.
    pub sessions: Vec<SavedSession>,
    /// Independent file report revision counters.
    pub file_revisions: FileRevisions,
    /// Accepted turns retained through confirmation of their end.
    pub turns: Vec<SavedTurn>,
    /// Retained reports and answered request IDs. Older files omit this field.
    #[serde(default)]
    pub reports: ReportState,
}

impl RunnerState {
    /// Empty state for a caller-supplied random stream ID.
    pub fn new(stream_id: String) -> Self {
        Self {
            stream_id,
            next_event_number: 1,
            confirmed_through: 0,
            outbox: vec![],
            sessions: vec![],
            file_revisions: FileRevisions::default(),
            turns: vec![],
            reports: ReportState::default(),
        }
    }

    /// Read the Node format and refuse a broken event sequence.
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        let state: Self = codec::decode(bytes)?;
        state.validate()?;
        Ok(state)
    }

    pub(super) fn validate(&self) -> Result<()> {
        let mut expected = self.confirmed_through + 1;
        for envelope in &self.outbox {
            let RunnerEventEnvelope::Event {
                stream_id,
                event_number,
                event,
                ..
            } = envelope;
            if stream_id != &self.stream_id || *event_number != expected {
                return Err(Error::InvalidOutbox);
            }
            validate_event(event)?;
            expected += 1;
        }
        if self.next_event_number != expected || expected > MAX_SAFE_INTEGER {
            return Err(Error::InvalidCounter);
        }
        Ok(())
    }
}

pub(super) fn validate_event(event: &RunnerEvent) -> Result<()> {
    if let RunnerEvent::RunnerPortsUpdated(RunnerPortsUpdated::PortsUpdated { ports }) = event
        && (ports.len() > PORT_REPORT_MAX_PORTS as usize
            || ports.iter().any(|port| !(1..=65535).contains(&port.port)))
    {
        return Err(Error::InvalidPorts);
    }
    Ok(())
}

/// File report revisions survive reconnects and restarts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FileRevisions {
    /// Last tree revision.
    pub tree: u64,
    /// Last changes revision.
    pub changes: u64,
}

/// Only conversation metadata is saved. A turn token cannot enter this type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSession {
    /// Workspace session identity.
    pub session_id: String,
    /// Agent that owns the conversation.
    pub agent: Agent,
    /// Provider conversation identity, when established.
    pub provider_session_id: Option<String>,
    /// Fixed instructions used by this session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// Absent and explicit null retain their distinct Node meanings.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_branches"
    )]
    pub instruction_branches: Option<Option<RunnerBranches>>,
}

fn present_branches<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Option<RunnerBranches>>, D::Error> {
    Option::<RunnerBranches>::deserialize(deserializer).map(Some)
}

/// The minimal recovery record for an accepted turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTurn {
    /// Workspace session identity.
    pub session_id: String,
    /// Workspace turn identity, paired with session_id.
    pub turn_id: String,
    /// Acceptance time in Unix milliseconds.
    pub started_at: u64,
    /// User messages attached to the accepted turn.
    pub message_ids: Vec<String>,
    /// Number of turn.started, or null before its start.
    pub start_event_number: Option<u64>,
    /// First saved or pending end number, or null while unfinished.
    pub end_event_number: Option<u64>,
}

/// Only these complete reports need durable copies outside the outbox.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RetainedReports {
    /// Last start report.
    #[serde(rename = "start.updated")]
    pub start: Option<RunnerStartUpdated>,
    /// Last workspace name.
    #[serde(rename = "workspace.title")]
    pub title: Option<RunnerWorkspaceTitle>,
}

/// Saved receipts suppress repeated report requests after restart.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ReportState {
    /// Most recent retained reports.
    pub latest: RetainedReports,
    /// IDs of answered report.refresh commands.
    pub commands: Vec<String>,
}
