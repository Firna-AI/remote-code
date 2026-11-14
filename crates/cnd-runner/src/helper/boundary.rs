//! Replaceable helper and process boundaries.

use std::sync::Arc;

use async_trait::async_trait;
use cnd_runner_interface::agents::AgentChoice;
use cnd_runner_interface::sdk_helper::{HelperModelResult, HelperOutput, HelperRequest};
use cnd_runner_interface::sdk_helper_options::{HelperOptions, ProviderInput};

use crate::error::Result;

/// One agent start. Close bypasses requests and waits for process exit.
#[cfg_attr(test, unimock::unimock(api = HelperMock))]
#[async_trait]
pub trait Helper: Send + Sync {
    /// Start one agent with private options.
    async fn start(&self, options: HelperOptions) -> Result<()>;
    /// Deliver one member input.
    async fn send(&self, input: ProviderInput) -> Result<()>;
    /// Apply or defer a model change.
    async fn model(&self, choice: AgentChoice) -> Result<HelperModelResult>;
    /// Interrupt a reply at a safe boundary.
    async fn interrupt(&self) -> Result<()>;
    /// Close setup and agent cleanup, then await helper OS exit.
    async fn close(&self) -> Result<()>;
}

/// Creates one helper per agent start. Opening registers output before start.
#[cfg_attr(test, unimock::unimock(api = HelperFactoryMock))]
pub trait HelperFactory: Send + Sync {
    /// Start private pipes. No request content may enter diagnostics.
    fn open(&self, output: Arc<dyn HelperEvents>) -> Result<Arc<dyn Helper>>;
}

/// Process boundary used by the correlated JSON-line driver.
#[cfg_attr(test, unimock::unimock(api = HelperPortMock))]
#[async_trait]
pub trait HelperPort: Send + Sync {
    /// Write one complete line to private stdin.
    async fn write(&self, request: HelperRequest) -> Result<()>;
    /// Receive the next complete line. EOF follows all output.
    async fn read(&self) -> Result<Option<HelperOutput>>;
    /// SIGTERM, then SIGKILL after ten seconds, and wait for exit.
    async fn terminate(&self) -> Result<()>;
    /// Wait for OS exit independently of stdout.
    async fn exited(&self) -> Result<()>;
}

/// Startup-only work, separate from reconnects and turn processes.
#[cfg_attr(test, unimock::unimock(api = StartupMock))]
#[async_trait]
pub trait Startup: Send + Sync {
    /// Remove stale credentials and warm the Claude executable once.
    async fn prepare(&self) -> Result<()>;
    /// Confirm the release once, only after the first valid welcome.
    async fn welcomed(&self) -> Result<()>;
}

/// Synchronous output delivery preserves ordering with later runner commands.
pub trait HelperEvents: Send + Sync {
    /// Queue one helper output without waiting on session work.
    fn output(&self, output: HelperOutput);
}

/// Opens private helper processes for the SDK and startup warm-up.
#[cfg_attr(test, unimock::unimock(api = HelperPortsMock))]
pub trait HelperPorts: Send + Sync {
    /// Open a process with private stdin and stdout.
    fn port(&self) -> Result<Arc<dyn HelperPort>>;
}
