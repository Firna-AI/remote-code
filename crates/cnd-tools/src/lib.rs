//! Workspace tool commands and the stdio MCP server.

mod call;
pub mod cli;
mod cli_parse;
pub mod client;
pub mod environment;
pub mod error;
mod input;
pub mod mcp;
pub mod ports;
mod reply;
mod reply_validation;
mod request;
pub mod runtime;
mod schema;
