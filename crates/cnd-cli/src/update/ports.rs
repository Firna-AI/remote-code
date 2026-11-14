//! Disk and process boundaries for update orchestration.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use cnd_release::parts::{Part, PartsList};
use serde::{Deserialize, Serialize};

use super::error::Result;

/// A held operating-system lock, released when its owner ends.
pub trait UpdateLock: Send + Sync {}

/// Releases involved in a restart-time transition.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct State {
    /// Active version, when already installed.
    pub current: Option<String>,
    /// Previous known release retained for fallback.
    pub previous: Option<String>,
    /// Version whose runner start has not succeeded yet.
    pub pending: Option<String>,
}

/// Persistent release store. All paths belong to its configured root.
#[cfg_attr(test, unimock::unimock(api = StoreMock))]
pub trait Store: Send + Sync {
    /// Try the exclusive download lock without waiting for another check.
    fn lock(&self) -> Result<Option<Box<dyn UpdateLock>>>;
    /// Wait for a background check before an installation reads or stages files.
    fn installation_lock(&self) -> Result<Box<dyn UpdateLock>>;
    /// Serialize activation and start confirmation independently of downloads.
    fn apply_lock(&self) -> Result<Option<Box<dyn UpdateLock>>>;
    /// Read active links and the pending marker.
    fn state(&self) -> Result<State>;
    /// Return only complete, non-rejected release versions.
    fn versions(&self) -> Result<Vec<String>>;
    /// Check the persistent rejection record, even after payload collection.
    fn rejected(&self, version: &str) -> Result<bool>;
    /// Return the path of a version folder.
    fn version_path(&self, version: &str) -> PathBuf;
    /// Prepare an incomplete folder with an executable seed for cli-updater.
    fn prepare(&self, version: &str) -> Result<()>;
    /// Check whether a complete content-addressed part already exists.
    fn has_part(&self, digest: &str) -> Result<bool>;
    /// Unpack a checked part into the content-addressed store.
    fn unpack(&self, part: &Part, bytes: &[u8]) -> Result<()>;
    /// Link all parts and write the complete marker last.
    fn complete(&self, version: &str, parts: &PartsList) -> Result<()>;
    /// Atomically replace one version link or marker. Pending is written first.
    fn transition(&self, state: &State) -> Result<()>;
    /// Exclude a failed release from later apply attempts.
    fn reject(&self, version: &str) -> Result<()>;
    /// Remove versions and parts outside the retained set under the download lock.
    fn collect(&self, keep: &[String]) -> Result<()>;
}

/// Execution of the downloaded executable and the root-owned installer.
#[cfg_attr(test, unimock::unimock(api = ProcessesMock))]
pub trait Processes: Send + Sync {
    /// Check the executable version and read its authenticated embedded parts.
    fn inspect(&self, executable: &Path, version: &str) -> Result<PartsList>;
    /// Install the active version's root-owned system files without starting units.
    fn install_system(&self, folder: &Path) -> Result<()>;
}

/// User-visible operations of the sandbox updater.
#[async_trait]
pub trait UpdateEngine: Send + Sync {
    /// Download in isolation. Warn and retain the active release on any failure.
    async fn check(&self, running_version: &str) -> Result<()>;
    /// Stage an image installation after any running background check finishes.
    async fn install(&self, running_version: &str) -> Result<()>;
    /// Activate the newest complete release or restore a failed start.
    fn apply(&self) -> Result<()>;
    /// Confirm only the running release after its first valid Worker welcome.
    fn started(&self, running_version: &str) -> Result<()>;
}
