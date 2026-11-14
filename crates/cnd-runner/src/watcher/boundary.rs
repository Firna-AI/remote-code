//! Injectable watch events and restore-marker checks.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use crate::error::Result;

/// Watch event sources do not perform repository scans themselves.
#[async_trait]
pub trait RepositoryWatch: Send + Sync {
    /// Wait for a recursive repository event. A driver supplies debounce timing.
    async fn changed(&self) -> Result<()>;
    /// Close the watch and unblock a pending wait.
    async fn close(&self);
}

/// Filesystem and time boundary for restore handling and scheduled reports.
#[cfg_attr(test, unimock::unimock(api = WatchDriverMock))]
#[async_trait]
pub trait WatchDriver: Send + Sync {
    /// Open a fresh recursive watch on the current live repository folder.
    async fn open(&self, root: PathBuf) -> Result<Arc<dyn RepositoryWatch>>;
    /// Test the marker even if its memory-backed parent did not exist at startup.
    async fn exists(&self, marker: PathBuf) -> bool;
    /// Cancellable scheduling, mocked or paused in deterministic tests.
    async fn delay(&self, duration: Duration);
}
