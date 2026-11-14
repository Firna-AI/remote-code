//! CLI and MCP entry points composed through effect traits.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::call::Name;
use crate::cli_parse;
use crate::client::{Client, Configuration, Dispatch};
use crate::error::{ErrorResultExt, Result};
use crate::input;
use crate::mcp::{Mcp, Server};
use crate::ports::{Http, Runtime, Streams};

/// Complete tool help, available without credentials.
pub const HELP: &str = include_str!("help.txt");

/// Check help without interpreting dash-prefixed session option values as flags.
pub fn help_requested(args: &[String]) -> bool {
    cli_parse::help(args)
}

/// Command and protocol execution boundary.
#[async_trait]
pub trait Program: Send + Sync {
    /// Run a CLI command and return its documented exit status.
    async fn cli(&self, args: &[String]) -> Result<u8>;
    /// Run the stdio protocol through EOF, then finish pending replies.
    async fn mcp(&self) -> Result<u8>;
}

/// Production tool program with injected dependencies.
pub struct ToolProgram {
    client: Arc<dyn Dispatch>,
    runtime: Arc<dyn Runtime>,
    streams: Arc<dyn Streams>,
}

impl ToolProgram {
    /// Compose the tool adapters without reading ambient state.
    pub fn new(
        configuration: Configuration,
        http: Arc<dyn Http>,
        runtime: Arc<dyn Runtime>,
        streams: Arc<dyn Streams>,
    ) -> Self {
        Self {
            client: Arc::new(Client::new(configuration, http, Arc::clone(&runtime))),
            runtime,
            streams,
        }
    }

    async fn command(&self, args: &[String]) -> Result<u8> {
        let mut args = cli_parse::parse(args)?;
        if let Some(path) = args.message_path {
            let text = self.runtime.message(&path).await?;
            args.fields.insert(
                if args.name == Name::SendMessage {
                    "text"
                } else {
                    "firstMessage"
                }
                .into(),
                Value::String(text),
            );
        }
        let call = input::parse(args.name, &args.fields, &self.runtime.request_id())?;
        let reply = self.client.execute(call).await?;
        self.streams
            .stdout(&format!("{}\n", serde_json::to_string(&reply).internal()?))
            .await?;
        Ok(u8::from(reply.failed()))
    }
}

#[async_trait]
impl Program for ToolProgram {
    async fn cli(&self, args: &[String]) -> Result<u8> {
        if help_requested(args) {
            self.streams.stdout(HELP).await?;
            return Ok(0);
        }
        match self.command(args).await {
            Ok(status) => Ok(status),
            Err(error) => {
                self.streams
                    .stderr(&format!("{}\n", error.message()))
                    .await?;
                Ok(1)
            }
        }
    }
    async fn mcp(&self) -> Result<u8> {
        let server: Box<dyn Mcp> = Box::new(Server::new(Arc::clone(&self.client)));
        server
            .serve(Arc::clone(&self.runtime), Arc::clone(&self.streams))
            .await
    }
}

#[cfg(test)]
#[path = "_tests_/cli_tests.rs"]
mod cli_tests;

#[cfg(test)]
#[path = "_tests_/mac_adapter_tests.rs"]
mod mac_adapter_tests;
