//! Mockable environment, HTTP, and terminal boundaries.

use async_trait::async_trait;

use crate::error::Result;

/// Unsaved context for one request. It intentionally has no Debug implementation.
pub struct Context {
    /// Machine origin from the sandbox settings.
    pub origin: String,
    /// Workspace bearer token from the sandbox settings.
    pub token: String,
    /// Caller's current turn, never the saved turn.
    pub turn: String,
}

/// Sandbox settings and caller identity.
#[cfg_attr(test, unimock::unimock(api = EnvironmentMock))]
pub trait Environment: Send + Sync {
    /// Resolve the saved sandbox settings while preserving the caller's turn.
    fn context(&self) -> Result<Context> {
        let turn = self.caller_turn();
        let [origin, token] = self.saved()?;
        Ok(Context {
            origin,
            token,
            turn,
        })
    }
    /// Read the turn before any saved shell settings are loaded.
    fn caller_turn(&self) -> String;
    /// Load only the machine origin and workspace token from the saved settings.
    fn saved(&self) -> Result<[String; 2]>;
}

/// Fresh token endpoint. Implementations must refuse redirects and use a timeout.
#[cfg_attr(test, unimock::unimock(api = HttpMock))]
#[async_trait]
pub trait Http: Send + Sync {
    /// POST with bearer and optional turn headers, with no body or content type.
    async fn credential(&self, context: Context) -> Result<Reply>;
}

/// Unparsed endpoint reply.
pub struct Reply {
    /// HTTP status.
    pub status: u16,
    /// JSON reply bytes, never logged.
    pub body: Vec<u8>,
}

/// Git protocol input and credential output.
#[cfg_attr(test, unimock::unimock(api = StreamsMock))]
#[async_trait]
pub trait Streams: Send + Sync {
    /// Read Git's fields only for a get request.
    async fn input(&self) -> Result<String>;
    /// Write the only permitted token output.
    async fn output(&self, value: String) -> Result<()>;
}

#[cfg(test)]
#[path = "_tests_/environment_tests.rs"]
mod environment_tests;
