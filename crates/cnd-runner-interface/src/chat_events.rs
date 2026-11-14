//! ChatEvents wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::AgentChoice;
use crate::api::Timestamp;
use crate::file_changes::ChangedFile;
use crate::wire::{ReadonlyVec, WireTrue};

/// AgentChatEventTurnCompletedState wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum AgentChatEventTurnCompletedState {
    /// finished.
    #[serde(rename = "finished")]
    Finished,
    /// stopped.
    #[serde(rename = "stopped")]
    Stopped,
}

/// AgentChatEventTurnFailedError wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatEventTurnFailedError {
    /// code.
    pub code: String,
    /// message.
    pub message: String,
}

/// Provider-neutral events. SDK messages and credentials never enter this union.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum AgentChatEvent {
    /// turn.started.
    #[serde(rename = "turn.started")]
    TurnStarted {
        /// Shared wire fields.
        #[serde(flatten)]
        turn_event_context: TurnEventContext,
        /// senderId.
        sender_id: String,
        /// choice.
        choice: AgentChoice,
        /// startedAt.
        started_at: Timestamp,
        /// messageIds.
        #[ts(as = "ReadonlyVec<String>")]
        message_ids: Vec<String>,
    },
    /// turn.thinking.
    #[serde(rename = "turn.thinking")]
    TurnThinking {
        /// Shared wire fields.
        #[serde(flatten)]
        turn_event_context: TurnEventContext,
    },
    /// assistant.delta.
    #[serde(rename = "assistant.delta")]
    AssistantDelta {
        /// Shared wire fields.
        #[serde(flatten)]
        turn_event_context: TurnEventContext,
        /// messageId.
        message_id: String,
        /// text.
        text: String,
    },
    /// assistant.completed.
    #[serde(rename = "assistant.completed")]
    AssistantCompleted {
        /// Shared wire fields.
        #[serde(flatten)]
        turn_event_context: TurnEventContext,
        /// messageId.
        message_id: String,
        /// text.
        text: String,
        /// One answer can respond to several user messages.
        #[ts(as = "ReadonlyVec<String>")]
        user_message_ids: Vec<String>,
    },
    /// tool.updated.
    #[serde(rename = "tool.updated")]
    ToolUpdated {
        /// Shared wire fields.
        #[serde(flatten)]
        turn_event_context: TurnEventContext,
        /// tool.
        tool: ToolCall,
    },
    /// turn.completed.
    #[serde(rename = "turn.completed")]
    TurnCompleted {
        /// Shared wire fields.
        #[serde(flatten)]
        turn_event_context: TurnEventContext,
        /// state.
        state: AgentChatEventTurnCompletedState,
        /// durationMs.
        #[ts(type = "number")]
        duration_ms: u64,
        /// endReason.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        end_reason: Option<TurnEndReason>,
        /// Reported speed of a turn that requested fast mode.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        speed: Option<TurnSpeed>,
        /// Keep a prefix of the full unique-path list. Entries stay whole.
        /// Apply both TURN_COMPLETED_MAX_FILES and TURN_COMPLETED_FILES_MAX_BYTES.
        #[ts(as = "ReadonlyVec<ChangedFile>")]
        files: Vec<ChangedFile>,
        /// Unknown changed files. When present, files is empty and omittedFileCount is zero.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        files_unavailable: Option<WireTrue>,
        /// Full list length minus files.length. A non-negative safe integer.
        #[ts(type = "number")]
        omitted_file_count: u64,
        /// userMessageIds.
        #[ts(as = "ReadonlyVec<String>")]
        user_message_ids: Vec<String>,
    },
    /// turn.failed.
    #[serde(rename = "turn.failed")]
    TurnFailed {
        /// Shared wire fields.
        #[serde(flatten)]
        turn_event_context: TurnEventContext,
        /// error.
        error: AgentChatEventTurnFailedError,
        /// retryMessageId.
        retry_message_id: String,
        /// durationMs.
        #[ts(type = "number")]
        duration_ms: u64,
    },
}

/// TurnEventContext wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TurnEventContext {
    /// sessionId.
    pub session_id: String,
    /// turnId.
    pub turn_id: String,
}

/// ToolCallKind wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum ToolCallKind {
    /// read.
    #[serde(rename = "read")]
    Read,
    /// search.
    #[serde(rename = "search")]
    Search,
    /// create.
    #[serde(rename = "create")]
    Create,
    /// edit.
    #[serde(rename = "edit")]
    Edit,
    /// run.
    #[serde(rename = "run")]
    Run,
    /// computer.
    #[serde(rename = "computer")]
    Computer,
    /// other.
    #[serde(rename = "other")]
    Other,
}

/// ToolCallState wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum ToolCallState {
    /// running.
    #[serde(rename = "running")]
    Running,
    /// done.
    #[serde(rename = "done")]
    Done,
    /// stopped.
    #[serde(rename = "stopped")]
    Stopped,
    /// failed.
    #[serde(rename = "failed")]
    Failed,
}

/// Keep the longest source prefix that fits TOOL_DETAIL_MAX_BYTES.
/// Replace lone UTF-16 surrogates with U+FFFD before counting or truncating.
/// Never split a Unicode code point. JSON escaping counts toward the cap.
/// Null means no detail. Do not insert an omission notice into this text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// id.
    pub id: String,
    /// kind.
    pub kind: ToolCallKind,
    /// target.
    pub target: String,
    /// Keep the longest source prefix that fits TOOL_DETAIL_MAX_BYTES.
    /// Replace lone UTF-16 surrogates with U+FFFD before counting or truncating.
    /// Never split a Unicode code point. JSON escaping counts toward the cap.
    /// Null means no detail. Do not insert an omission notice into this text.
    pub detail: Option<String>,
    /// UTF-8 bytes of the omitted normalized suffix, before JSON escaping.
    /// This non-negative safe integer is zero for null or complete detail.
    /// Each tool update counts its full source detail, not previous updates.
    #[ts(type = "number")]
    pub omitted_detail_bytes: u64,
    /// state.
    pub state: ToolCallState,
}

/// A cause other than the end of the agent's reply that finished a turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum TurnEndReason {
    /// background_work_limit.
    #[serde(rename = "background_work_limit")]
    BackgroundWorkLimit,
}

/// Speed of a turn that requested fast mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum TurnSpeed {
    /// The turn used fast mode.
    Fast,
    /// The turn used standard speed, with an optional machine-readable cause.
    Standard {
        /// Known causes include fast_limit and older_runner.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        cause: Option<String>,
    },
}

/// Shared tool detail max bytes.
pub const TOOL_DETAIL_MAX_BYTES: u64 = 65_536;

/// Shared turn completed max files.
pub const TURN_COMPLETED_MAX_FILES: u64 = 200;

/// Shared turn completed files max bytes.
pub const TURN_COMPLETED_FILES_MAX_BYTES: u64 = 262_144;
