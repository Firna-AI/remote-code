//! RunnerHandshake wire contracts.

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use ts_rs::TS;

use crate::api::Timestamp;
use crate::runner::RunnerEvent;
use crate::runner_commands::RunnerCommand;
use crate::runner_credentials::RunnerLoginKind;
use crate::runner_files::RunnerFileResponse;
use crate::wire::ReadonlyVec;

/// RunnerToWorkspace wire alternatives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum RunnerToWorkspace {
    /// RunnerHello.
    RunnerHello(RunnerHello),
    /// RunnerEventEnvelope.
    RunnerEventEnvelope(RunnerEventEnvelope),
    /// RunnerFileResponse.
    RunnerFileResponse(RunnerFileResponse),
}

/// The bearer token authenticates the outbound socket on the machine hostname.
/// Send hello first. Unsupported versions close before welcome or commands.
/// A stream ID and its counter persist with the runner outbox across reconnects.
/// An outbox contains events only. It must never contain turn credentials.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerHello {
    /// hello.
    #[serde(rename = "hello")]
    Hello {
        /// protocolVersion.
        protocol_version: RunnerProtocolVersion,
        /// workspaceId.
        workspace_id: String,
        /// streamId.
        stream_id: String,
        /// loginKinds.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[ts(as = "Option<ReadonlyVec<RunnerLoginKind>>")]
        login_kinds: Option<Vec<RunnerLoginKind>>,
    },
}

/// Each stream numbers events from 1. Retries keep the same number and payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerEventEnvelope {
    /// event.
    #[serde(rename = "event")]
    Event {
        /// streamId.
        stream_id: String,
        /// eventNumber.
        #[ts(type = "number")]
        event_number: u64,
        /// occurredAt.
        occurred_at: Timestamp,
        /// event.
        event: RunnerEvent,
    },
}

/// WorkspaceToRunner wire alternatives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum WorkspaceToRunner {
    /// RunnerWelcome.
    RunnerWelcome(RunnerWelcome),
    /// RunnerConfirm.
    RunnerConfirm(RunnerConfirm),
    /// RunnerResend.
    RunnerResend(RunnerResend),
    /// RunnerCommand.
    RunnerCommand(Box<RunnerCommand>),
}

/// On welcome, discard confirmed outbox entries and resend every later entry.
/// On resend, send every retained entry from fromEventNumber, in number order.
/// A duplicate is confirmed again but is neither stored nor broadcast again.
/// A gap requests resend. It never advances the stored cursor.
/// The workspace gives browser events its own numbers across runner streams.
/// Refusal reasons are too_large, invalid, and turn_not_active. A refusal
/// stores one workspace-only marker before confirming and advancing the cursor.
/// A refused turn.completed or turn.failed still ends its active turn.
/// A storage or network failure is not a refusal. Close without confirming.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerWelcome {
    /// welcome.
    #[serde(rename = "welcome")]
    Welcome {
        /// protocolVersion.
        protocol_version: RunnerProtocolVersion,
        /// streamId.
        stream_id: String,
        /// confirmedThrough.
        #[ts(type = "number")]
        confirmed_through: u64,
    },
}

/// A confirm covers contiguous stored events or their stored refusal markers.
/// The runner removes either result from its outbox and never retries it.
/// A confirmed file part includes durable assembly state across reconnects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerConfirm {
    /// confirm.
    #[serde(rename = "confirm")]
    Confirm {
        /// streamId.
        stream_id: String,
        /// throughEventNumber.
        #[ts(type = "number")]
        through_event_number: u64,
    },
}

/// RunnerResend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerResend {
    /// resend.
    #[serde(rename = "resend")]
    Resend {
        /// streamId.
        stream_id: String,
        /// fromEventNumber.
        #[ts(type = "number")]
        from_event_number: u64,
    },
}

/// The only supported runner protocol version.
pub const RUNNER_PROTOCOL_VERSION: u8 = 2;

/// Maximum compact JSON bytes in a complete runner event envelope.
pub const RUNNER_EVENT_MAX_BYTES: u64 = 1_048_576;

/// Only protocol version 2 is valid on the wire.
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(type = "2")]
pub struct RunnerProtocolVersion;

impl Serialize for RunnerProtocolVersion {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u8(RUNNER_PROTOCOL_VERSION)
    }
}

impl<'de> Deserialize<'de> for RunnerProtocolVersion {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if u8::deserialize(deserializer)? == RUNNER_PROTOCOL_VERSION {
            Ok(Self)
        } else {
            Err(D::Error::custom("unsupported runner protocol version"))
        }
    }
}
