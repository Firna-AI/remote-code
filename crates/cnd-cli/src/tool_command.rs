//! Composition root for the workspace CLI and stdio MCP server.

use std::sync::Arc;

use cnd_cli::environment::NativeEnvironment;
use cnd_tools::cli::{self, Program, ToolProgram};
use cnd_tools::environment::Environment;
use cnd_tools::error::Result;
use cnd_tools::ports::{Runtime, Streams};
use cnd_tools::runtime::{NativeHttp, NativeRuntime, NativeStreams};

pub(crate) fn selected(args: &[String]) -> bool {
    args.is_empty()
        || args.first().is_some_and(|group| {
            matches!(
                group.as_str(),
                "mcp"
                    | "workspaces"
                    | "sessions"
                    | "messages"
                    | "sections"
                    | "repositories"
                    | "models"
                    | "previews"
                    | "mac"
            )
        })
}

pub(crate) async fn execute(args: Vec<String>) -> u8 {
    match run(args).await {
        Ok(status) => status,
        Err(error) => {
            eprintln!("{}", error.message());
            1
        }
    }
}

async fn run(args: Vec<String>) -> Result<u8> {
    let streams: Arc<dyn Streams> = Arc::new(NativeStreams::default());
    if cli::help_requested(&args) {
        streams.stdout(cli::HELP).await?;
        return Ok(0);
    }
    let configuration = NativeEnvironment::default().configuration()?;
    let runtime: Arc<dyn Runtime> = Arc::new(NativeRuntime);
    let program: Box<dyn Program> = Box::new(ToolProgram::new(
        configuration,
        Arc::new(NativeHttp::new()?),
        runtime,
        streams,
    ));
    if args == ["mcp"] {
        program.mcp().await
    } else {
        program.cli(&args).await
    }
}
