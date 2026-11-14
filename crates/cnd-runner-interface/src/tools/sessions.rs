//! Session creation, message acceptance, and resume replies.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::Effort;
use crate::messages::UserMessage;

use super::resources::{AgentRequestModel, AgentToolFailure};
use super::session_types::{AgentLinkedSession, Session};
use super::workspaces::AgentWorkspaceSummary;

/// AgentCreateSessionRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateSessionRequest {
    /// model.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<AgentRequestModel>,
    /// effort.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effort: Option<Effort>,
    /// Explicit fast override. Omission creates at standard speed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fast: Option<bool>,
    /// request id.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub request_id: Option<String>,
    /// title.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    /// first message.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub first_message: Option<String>,
}

/// AgentSendMessageRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSendMessageRequest {
    /// model.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<AgentRequestModel>,
    /// effort.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effort: Option<Effort>,
    /// Explicit fast override. Omission preserves the session speed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fast: Option<bool>,
    /// request id.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub request_id: Option<String>,
    /// text.
    pub text: String,
}

/// Accepted session data keeps message and turn presence correlated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum AgentSessionAccepted {
    /// An empty session was created.
    Empty {
        /// session.
        session: Session,
        /// event number.
        event_number: u64,
        /// No message was sent.
        message: (),
        /// No turn was started.
        turn_id: (),
    },
    /// A message was accepted into a turn.
    Message {
        /// session.
        session: Session,
        /// event number.
        event_number: u64,
        /// The accepted message.
        message: Box<UserMessage>,
        /// The turn that accepted the message.
        turn_id: String,
    },
}

/// Current state of the resume after an accepted session write.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state")]
pub enum AgentSessionResume {
    /// The workspace needed no resume.
    #[serde(rename = "not_needed", rename_all = "camelCase")]
    NotNeeded {
        /// No resume error.
        error: (),
    },
    /// A resume was queued.
    #[serde(rename = "queued", rename_all = "camelCase")]
    Queued {
        /// No resume error.
        error: (),
    },
    /// The accepted write waits for a resume.
    #[serde(rename = "waiting", rename_all = "camelCase")]
    Waiting {
        /// No resume error.
        error: (),
    },
    /// A resume failed after acceptance.
    #[serde(rename = "failed", rename_all = "camelCase")]
    Failed {
        /// The existing public error code and message.
        error: AgentToolFailure,
    },
}

/// A session write reply keeps the accepted message and turn correlated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum AgentSessionWriteResponse {
    /// An empty session was created.
    Empty {
        /// workspace.
        workspace: AgentWorkspaceSummary,
        /// session.
        session: AgentLinkedSession,
        /// event number.
        event_number: u64,
        /// resume.
        resume: AgentSessionResume,
        /// No message was sent.
        message: (),
        /// No turn was started.
        turn_id: (),
    },
    /// A message was accepted into a turn.
    Message {
        /// workspace.
        workspace: AgentWorkspaceSummary,
        /// session.
        session: AgentLinkedSession,
        /// event number.
        event_number: u64,
        /// resume.
        resume: AgentSessionResume,
        /// The accepted message.
        message: Box<UserMessage>,
        /// The turn that accepted the message.
        turn_id: String,
    },
}

/// The reply to creating a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AgentCreateSessionResponse(pub AgentSessionWriteResponse);

/// A sent message always has an accepted message and turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSendMessageResponse {
    /// workspace.
    pub workspace: AgentWorkspaceSummary,
    /// session.
    pub session: AgentLinkedSession,
    /// event number.
    pub event_number: u64,
    /// resume.
    pub resume: AgentSessionResume,
    /// The accepted message.
    pub message: UserMessage,
    /// The turn that accepted the message.
    pub turn_id: String,
}
