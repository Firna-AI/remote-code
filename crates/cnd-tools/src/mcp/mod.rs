//! Concurrent workspace tool requests over stdio MCP.

mod protocol;
mod server;
mod wire;

pub(crate) use self::server::{Mcp, Server};

/// Fixed supported MCP revision.
pub const PROTOCOL_VERSION: &str = "2025-11-25";
