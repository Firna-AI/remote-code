//! Agent adapter events shared by the runner and SDK helper.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::chat_events::{ToolCall, TurnEndReason, TurnSpeed};
use crate::wire::ReadonlyVec;

/// Completion state of an agent reply.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ProviderResultState {
    /// The reply finished normally.
    Finished,
    /// The reply was interrupted.
    Stopped,
}

/// Output of one SDK agent process, before the runner output filter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ProviderEvent {
    /// Updated conversation reference.
    #[serde(rename = "conversation")]
    Conversation {
        /// Provider conversation ID.
        id: String,
    },
    /// The agent started thinking.
    #[serde(rename = "thinking")]
    Thinking,
    /// Speed reported by the agent for the visible turn.
    #[serde(rename = "speed")]
    Speed {
        /// Fast speed or a standard-speed fallback.
        speed: TurnSpeed,
    },
    /// Partial answer text.
    #[serde(rename = "delta")]
    Delta {
        /// Answer identity.
        message_id: String,
        /// Text to append.
        text: String,
    },
    /// Completed answer text.
    #[serde(rename = "answer")]
    Answer {
        /// Answer identity.
        message_id: String,
        /// Full answer text.
        text: String,
        /// Exact input messages answered.
        #[ts(as = "ReadonlyVec<String>")]
        user_message_ids: Vec<String>,
    },
    /// Tool activity.
    #[serde(rename = "tool")]
    Tool {
        /// Current tool state.
        tool: ToolCall,
    },
    /// Background work state.
    #[serde(rename = "background")]
    Background {
        /// Whether live work remains.
        live: bool,
        /// Whether the agent is idle.
        idle: bool,
    },
    /// Current agent activity.
    #[serde(rename = "activity")]
    Activity {
        /// Whether the agent is idle.
        idle: bool,
    },
    /// A background wake-up reply ended.
    #[serde(rename = "wake-up")]
    WakeUp {
        /// Reply outcome.
        state: ProviderResultState,
    },
    /// A reply answered the listed inputs.
    #[serde(rename = "result")]
    Result {
        /// Reply outcome.
        state: ProviderResultState,
        /// Exact input messages answered.
        #[ts(as = "ReadonlyVec<String>")]
        user_message_ids: Vec<String>,
        /// Optional turn end reason.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        end_reason: Option<TurnEndReason>,
    },
    /// An agent failure.
    #[serde(rename = "failed")]
    Failed {
        /// Stable error code.
        code: String,
        /// Displayable failure cause.
        message: String,
    },
}
