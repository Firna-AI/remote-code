//! Injected turn effects shared by session actors.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::clock::Clock;
use crate::config::Configuration;
use crate::emitter::EventEmitter;
use crate::filter::service::Credentials;
use crate::helper::boundary::{HelperFactory, Startup};
use crate::repository::git::{Cancellation, GitRunner};
use crate::repository::io::RepositoryIo;
use crate::repository::service::{GitRepository, Repository};
use crate::state::store::EventStore;

/// Creates independently cancellable repository operations for each turn.
#[cfg_attr(test, unimock::unimock(api = TurnRepositoriesMock))]
pub trait TurnRepositories: Send + Sync {
    /// Resolve the repository path again and share cancellation with Git.
    fn open(&self, cancellation: Cancellation) -> Arc<dyn Repository>;
}

/// All external effects of the turn engine.
pub struct EngineDependencies {
    /// Workspace settings used to build new instructions and tool context.
    pub configuration: Configuration,
    /// Loaded, shared durable state.
    pub store: Arc<dyn EventStore>,
    /// Filtered saving emitter.
    pub emitter: Arc<dyn EventEmitter>,
    /// Same credential filter as reports and helper warnings.
    pub credentials: Arc<dyn Credentials>,
    /// One private helper per agent start.
    pub helpers: Arc<dyn HelperFactory>,
    /// Cancellable repository factories.
    pub repositories: Arc<dyn TurnRepositories>,
    /// Unix clock; timers use Tokio's controllable scheduler.
    pub clock: Arc<dyn Clock>,
    /// Startup cleanup, warm-up, and welcome confirmation.
    pub startup: Arc<dyn Startup>,
    /// Production uses thirty days. Harnesses may supply shorter durations.
    pub background_limit: Duration,
}

/// Production turn repositories share boundaries and own fresh cancellation.
pub struct GitTurnRepositories {
    /// Workspace repository root.
    pub root: PathBuf,
    /// External Git command boundary.
    pub git: Arc<dyn GitRunner>,
    /// Verified filesystem boundary.
    pub io: Arc<dyn RepositoryIo>,
}

impl TurnRepositories for GitTurnRepositories {
    fn open(&self, cancellation: Cancellation) -> Arc<dyn Repository> {
        Arc::new(GitRepository::new(
            self.root.clone(),
            self.git.clone(),
            self.io.clone(),
            cancellation,
        ))
    }
}
