//! Files wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// FileResponseEncoding wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum FileResponseEncoding {
    /// utf-8.
    #[serde(rename = "utf-8")]
    Utf8,
    /// base64.
    #[serde(rename = "base64")]
    Base64,
}

/// FileResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileResponse {
    /// path.
    pub path: String,
    /// displayPath.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display_path: Option<String>,
    /// mediaType.
    pub media_type: String,
    /// sizeBytes.
    #[ts(type = "number")]
    pub size_bytes: u64,
    /// encoding.
    pub encoding: FileResponseEncoding,
    /// content.
    pub content: String,
}

/// DiffResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    /// path.
    pub path: String,
    /// displayPath.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display_path: Option<String>,
    /// baseBranch.
    pub base_branch: String,
    /// displayBaseBranch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display_base_branch: Option<String>,
    /// oldContent.
    pub old_content: Option<String>,
    /// newContent.
    pub new_content: Option<String>,
    /// patch.
    pub patch: String,
    /// binary.
    pub binary: bool,
}

/// Shared file read max bytes.
pub const FILE_READ_MAX_BYTES: u64 = 5_242_880;
