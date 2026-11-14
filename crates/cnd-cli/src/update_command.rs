//! Compose the production update dependencies and expose the subcommands.

use std::path::{PathBuf, absolute};
use std::sync::Arc;

use clap::{Args, Subcommand};
use cli_updater::TarGzBinaryInstaller;
use cnd_cli::update::disk::DiskStore;
use cnd_cli::update::engine::Engine;
use cnd_cli::update::http::release_client;
use cnd_cli::update::ports::UpdateEngine;
use cnd_cli::update::process::{SYSTEM_PART, SystemProcesses};
use cnd_cli::update::staging::NODE_PART;
use cnd_release::version::{BASE_URL, DEVELOPMENT_VERSION};

use crate::error::{ErrorResultExt, Result};
use crate::release;
use crate::runner_command::SDK_HELPER_PART;

/// Options shared by the software update operations.
#[derive(Debug, Args)]
pub(crate) struct UpdateArgs {
    /// Installation root. Use a separate folder for local verification.
    #[arg(long, default_value = "/opt/conductive", global = true)]
    root: PathBuf,
    /// Release server base URL.
    #[arg(long, default_value = BASE_URL, global = true)]
    server: String,
    #[command(subcommand)]
    operation: Operation,
}

#[derive(Debug, Subcommand)]
enum Operation {
    /// Download the newest release without changing the active release.
    Check {
        /// Stage the first installed release, even when the bootstrap has its version.
        #[arg(long)]
        bootstrap: bool,
    },
    /// Apply a complete download before services start. Requires root.
    Apply,
    /// Confirm that the runner has started. Requires root.
    Started,
    /// Print the parts embedded in this executable.
    Parts,
}

pub(crate) async fn execute(args: UpdateArgs) -> Result<()> {
    if matches!(args.operation, Operation::Parts) {
        let parts = release::parts()?;
        if release::VERSION != DEVELOPMENT_VERSION {
            parts
                .require(&[NODE_PART, SDK_HELPER_PART, SYSTEM_PART])
                .internal()?;
        }
        println!("{}", serde_json::to_string(&parts).internal()?);
        return Ok(());
    }
    let engine = Engine {
        store: Arc::new(DiskStore::new(absolute(args.root).internal()?)),
        client: Arc::new(release_client(&args.server).internal()?),
        installer: Arc::new(TarGzBinaryInstaller::new()),
        processes: Arc::new(SystemProcesses),
    };
    let engine: &dyn UpdateEngine = &engine;
    match args.operation {
        Operation::Check { bootstrap } => {
            let version = if bootstrap {
                DEVELOPMENT_VERSION
            } else {
                release::VERSION
            };
            if bootstrap {
                engine.install(version).await.internal()
            } else {
                engine.check(version).await.internal()
            }
        }
        Operation::Apply => engine.apply().internal(),
        Operation::Started => engine.started(release::VERSION).internal(),
        Operation::Parts => Ok(()),
    }
}
