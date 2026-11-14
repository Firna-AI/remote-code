//! CommitAuthor wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// CommitAuthor wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitAuthor {
    /// name.
    pub name: String,
    /// email.
    pub email: String,
}
