//! Session records and transcript detail used by workspace tools.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::AgentChoice;
use crate::api::Timestamp;
use crate::messages::MessageSender;

/// TranscriptDetail wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum TranscriptDetail {
    /// concise.
    #[serde(rename = "concise")]
    Concise,
    /// full.
    #[serde(rename = "full")]
    Full,
}

/// Session wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// id.
    pub id: String,
    /// workspace id.
    pub workspace_id: String,
    /// title.
    pub title: Option<String>,
    /// The agent stays fixed; another agent opens another session.
    pub choice: AgentChoice,
    /// created at.
    pub created_at: Timestamp,
    /// closed at.
    pub closed_at: Option<Timestamp>,
    /// active turn id.
    pub active_turn_id: Option<String>,
    /// The stored start time of the active turn, or null before dispatch.
    pub active_turn_started_at: Option<Timestamp>,
    /// retry message id.
    pub retry_message_id: Option<String>,
    /// started by.
    pub started_by: Option<MessageSender>,
    /// source session id.
    pub source_session_id: Option<String>,
    /// login available.
    pub login_available: bool,
    /// login shared.
    pub login_shared: bool,
}

/// An accepted session with its canonical web link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentLinkedSession {
    /// session.
    #[serde(flatten)]
    pub session: Session,
    /// link.
    pub link: String,
}

/// The identity and canonical web link of a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionLink {
    /// id.
    pub id: String,
    /// link.
    pub link: String,
}
