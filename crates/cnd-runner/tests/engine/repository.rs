//! Repository effects with explicit read barriers and captured cancellation.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cnd_runner::engine::dependencies::TurnRepositories;
use cnd_runner::repository::error::{Error, Result};
use cnd_runner::repository::git::Cancellation;
use cnd_runner::repository::service::{Checkpoint, Repository, RepositorySnapshot};
use cnd_runner_interface::file_changes::{ChangedFile, ChangesResponse};
use cnd_runner_interface::files::{DiffResponse, FileResponse};

use super::helpers::Gate;

#[derive(Default)]
pub(super) struct Repositories {
    pub baseline_gate: Gate,
    pub files_gate: Gate,
    pub fail_baseline: AtomicBool,
    pub fail_files: AtomicBool,
    pub files: Mutex<Vec<ChangedFile>>,
    pub cancellations: Mutex<Vec<Cancellation>>,
}
struct TurnRepository {
    state: Arc<Repositories>,
    cancellation: Cancellation,
}
pub(super) struct Factory(pub Arc<Repositories>);
impl TurnRepositories for Factory {
    fn open(&self, cancellation: Cancellation) -> Arc<dyn Repository> {
        if let Ok(mut captures) = self.0.cancellations.lock() {
            captures.push(cancellation.clone());
        }
        Arc::new(TurnRepository {
            state: self.0.clone(),
            cancellation,
        })
    }
}
#[async_trait]
impl Repository for TurnRepository {
    async fn prepare_context(&self) -> Result<()> {
        Ok(())
    }
    async fn snapshot(&self, _: String) -> Result<RepositorySnapshot> {
        Err(Error::Unavailable)
    }
    async fn changes(&self, _: String) -> Result<ChangesResponse> {
        Err(Error::Unavailable)
    }
    async fn read(&self, _: String, _: u64) -> Result<FileResponse> {
        Err(Error::Unavailable)
    }
    async fn diff(&self, _: String, _: String) -> Result<DiffResponse> {
        Err(Error::Unavailable)
    }
    async fn checkpoint(&self) -> Result<Checkpoint> {
        self.state.baseline_gate.wait().await;
        self.cancellation.check()?;
        if self.state.fail_baseline.swap(false, Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        Ok(BTreeMap::new())
    }
    async fn changed_since(&self, _: String, _: Checkpoint) -> Result<Vec<ChangedFile>> {
        self.state.files_gate.wait().await;
        self.cancellation.check()?;
        if self.state.fail_files.load(Ordering::SeqCst) {
            return Err(Error::Unavailable);
        }
        Ok(self.state.files.lock().or(Err(Error::Unavailable))?.clone())
    }
}
