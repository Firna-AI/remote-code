//! Replaceable effects for HTTP, input, polling, and stdio.

use async_trait::async_trait;

use crate::error::Result;

/// One authenticated fixed-route HTTP request.
#[derive(Clone)]
pub struct HttpRequest {
    /// Absolute URL on the configured machine origin.
    pub url: String,
    /// Workspace bearer token. Never include this struct in diagnostics.
    pub token: String,
    /// Active turn identity, when supplied.
    pub turn_id: Option<String>,
    /// JSON body; absence selects GET, presence selects POST.
    pub body: Option<String>,
}

/// The response before typed contract decoding.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    /// HTTP status code.
    pub status: u16,
    /// Raw response body, never exposed in failure diagnostics.
    pub body: String,
}

/// HTTP boundary with redirect following disabled.
#[cfg_attr(test, unimock::unimock(api = HttpMock))]
#[async_trait]
pub trait Http: Send + Sync {
    /// Send one authenticated request.
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse>;
}

/// Runtime reads and Mac polling waits.
#[cfg_attr(test, unimock::unimock(api = RuntimeMock))]
#[async_trait]
pub trait Runtime: Send + Sync {
    /// Read a saved UTF-8 message, or raw stdin when path is `-`.
    async fn message(&self, path: &str) -> Result<String>;
    /// Make a new opaque retry identity.
    fn request_id(&self) -> String;
    /// Wait before the next Mac result read.
    async fn wait(&self);
}

/// MCP lines and command output streams.
#[cfg_attr(test, unimock::unimock(api = StreamsMock))]
#[async_trait]
pub trait Streams: Send + Sync {
    /// Read a protocol line. None marks EOF.
    async fn line(&self) -> Result<Option<String>>;
    /// Write intended command or protocol output.
    async fn stdout(&self, text: &str) -> Result<()>;
    /// Write a safe command error.
    async fn stderr(&self, text: &str) -> Result<()>;
}
