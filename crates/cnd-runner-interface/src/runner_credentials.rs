//! Agent login capabilities and temporary turn credentials.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The supported login kinds of one agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum LoginKind {
    /// Agent subscription token.
    #[serde(rename = "token")]
    Token,
    /// Agent API key.
    #[serde(rename = "api-key")]
    ApiKey,
}

/// One agent and login kind that the runner supports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "agent")]
pub enum RunnerLoginKind {
    /// Claude credentials.
    #[serde(rename = "claude")]
    Claude {
        /// Supported login kind.
        kind: LoginKind,
    },
    /// Codex credentials.
    #[serde(rename = "codex")]
    Codex {
        /// Supported login kind.
        kind: LoginKind,
    },
}

/// An agent login. Turn commands carry a temporary credential instead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct RunnerLogin {
    /// Agent and login kind.
    #[serde(flatten)]
    pub login: RunnerLoginKind,
    /// Private agent login value.
    pub secret: String,
}

/// The only prompt cache lifetime requested by the Worker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum PromptCacheTtl {
    /// One hour.
    #[serde(rename = "1h")]
    OneHour,
}

/// Public account claims for a temporary Codex login file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RunnerCodexAccount {
    /// Account identity.
    pub account_id: String,
    /// Public email claim, when known.
    pub email: Option<String>,
    /// Public plan claim, when known.
    pub plan_type: Option<String>,
    /// Public user identity, when known.
    pub user_id: Option<String>,
}

/// Codex credential fields depend on the login kind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind")]
pub enum CodexTurnCredential {
    /// A temporary API key credential.
    #[serde(rename = "api-key")]
    ApiKey {
        /// Temporary model gateway token.
        token: String,
    },
    /// A temporary subscription credential and public account claims.
    #[serde(rename = "token")]
    Token {
        /// Temporary model gateway token.
        token: String,
        /// Public account claims.
        account: RunnerCodexAccount,
    },
}

/// Turn credentials never enter the runner event outbox.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "agent", rename_all_fields = "camelCase")]
pub enum RunnerTurnCredential {
    /// A temporary Claude credential.
    #[serde(rename = "claude")]
    Claude {
        /// Agent login kind.
        kind: LoginKind,
        /// Temporary model gateway token.
        token: String,
        /// Optional own endpoint prompt cache request.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        prompt_cache_ttl: Option<PromptCacheTtl>,
    },
    /// A temporary Codex credential.
    #[serde(rename = "codex")]
    Codex {
        /// Login-specific fields.
        #[serde(flatten)]
        credential: CodexTurnCredential,
    },
}
