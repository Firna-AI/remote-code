//! Messages wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::AgentChoice;
use crate::api::Timestamp;
use crate::wire::ReadonlyVec;

/// UserMessageState wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum UserMessageState {
    /// queued.
    #[serde(rename = "queued")]
    Queued,
    /// sent.
    #[serde(rename = "sent")]
    Sent,
}

/// UserMessage wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UserMessage {
    /// id.
    pub id: String,
    /// sessionId.
    pub session_id: String,
    /// sender.
    pub sender: MessageSender,
    /// text.
    pub text: String,
    /// attachments.
    #[ts(as = "ReadonlyVec<Attachment>")]
    pub attachments: Vec<Attachment>,
    /// choice.
    pub choice: AgentChoice,
    /// createdAt.
    pub created_at: Timestamp,
    /// state.
    pub state: UserMessageState,
}

/// MessageSender wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MessageSender {
    /// id.
    pub id: String,
    /// githubLogin.
    pub github_login: String,
    /// displayName.
    pub display_name: Option<String>,
    /// avatarUrl.
    pub avatar_url: Option<String>,
}

/// AttachmentKind wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum AttachmentKind {
    /// image.
    #[serde(rename = "image")]
    Image,
    /// file.
    #[serde(rename = "file")]
    File,
}

/// Attachment wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// id.
    pub id: String,
    /// name.
    pub name: String,
    /// path.
    pub path: Option<String>,
    /// kind.
    pub kind: AttachmentKind,
    /// mediaType.
    pub media_type: String,
    /// sizeBytes.
    #[ts(type = "number")]
    pub size_bytes: u64,
}
