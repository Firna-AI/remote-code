//! A store boundary that signals the installation lock attempt.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::Sender;

use cnd_cli::update::disk::DiskStore;
use cnd_cli::update::error::Result;
use cnd_cli::update::ports::{State, Store, UpdateLock};
use cnd_release::parts::{Part, PartsList};

pub(crate) struct ObservedStore {
    pub(crate) disk: Arc<DiskStore>,
    pub(crate) attempt: Sender<()>,
}

impl Store for ObservedStore {
    fn installation_lock(&self) -> Result<Box<dyn UpdateLock>> {
        assert!(self.attempt.send(()).is_ok());
        self.disk.installation_lock()
    }
    fn lock(&self) -> Result<Option<Box<dyn UpdateLock>>> {
        let result = self.disk.lock();
        assert!(self.attempt.send(()).is_ok());
        result
    }
    fn apply_lock(&self) -> Result<Option<Box<dyn UpdateLock>>> {
        self.disk.apply_lock()
    }
    fn state(&self) -> Result<State> {
        self.disk.state()
    }
    fn rejected(&self, version: &str) -> Result<bool> {
        self.disk.rejected(version)
    }
    fn versions(&self) -> Result<Vec<String>> {
        self.disk.versions()
    }
    fn version_path(&self, version: &str) -> PathBuf {
        self.disk.version_path(version)
    }
    fn prepare(&self, version: &str) -> Result<()> {
        self.disk.prepare(version)
    }
    fn has_part(&self, digest: &str) -> Result<bool> {
        self.disk.has_part(digest)
    }
    fn unpack(&self, part: &Part, bytes: &[u8]) -> Result<()> {
        self.disk.unpack(part, bytes)
    }
    fn complete(&self, version: &str, parts: &PartsList) -> Result<()> {
        self.disk.complete(version, parts)
    }
    fn transition(&self, state: &State) -> Result<()> {
        self.disk.transition(state)
    }
    fn reject(&self, version: &str) -> Result<()> {
        self.disk.reject(version)
    }
    fn collect(&self, keep: &[String]) -> Result<()> {
        self.disk.collect(keep)
    }
}
