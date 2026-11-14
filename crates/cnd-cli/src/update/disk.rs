//! Filesystem implementation of the isolated version and part store.

use std::fs::{self, File, TryLockError};
use std::path::{Path, PathBuf};

use cnd_release::parts::{Part, PartsList};

use super::error::{ErrorResultExt, Result};
use super::ports::{State, Store, UpdateLock};

/// On-disk release store. Production uses `/opt/conductive`.
pub struct DiskStore {
    pub(super) root: PathBuf,
}

impl DiskStore {
    /// Configure an absolute installation root without performing IO.
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn lock_file(&self, name: &str) -> Result<File> {
        fs::create_dir_all(&self.root).internal()?;
        File::options()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.root.join(name))
            .internal()
    }

    fn named_lock(&self, name: &str) -> Result<Option<Box<dyn UpdateLock>>> {
        let file = self.lock_file(name)?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Box::new(file))),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Error(error)) => Err(error).internal(),
        }
    }

    pub(super) fn part_path(&self, digest: &str) -> PathBuf {
        self.root.join("parts").join(digest.to_ascii_lowercase())
    }

    pub(super) fn read_link(&self, name: &str) -> Result<Option<String>> {
        let path = self.root.join(name);
        match fs::read_link(&path) {
            Ok(target) => Ok(target
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_owned)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).internal(),
        }
    }

    pub(super) fn link(&self, name: &str, target: Option<&Path>) -> Result<()> {
        let path = self.root.join(name);
        match target {
            Some(target) => {
                let temporary = self.root.join(format!("{name}.next"));
                self.remove(&temporary)?;
                std::os::unix::fs::symlink(target, &temporary).internal()?;
                fs::rename(temporary, path).internal()
            }
            None => self.remove(&path),
        }
    }

    pub(super) fn remove(&self, path: &Path) -> Result<()> {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error).internal(),
        }
    }
}

impl UpdateLock for File {}

impl Store for DiskStore {
    fn installation_lock(&self) -> Result<Box<dyn UpdateLock>> {
        let file = self.lock_file("update.lock")?;
        file.lock().internal()?;
        Ok(Box::new(file))
    }

    fn lock(&self) -> Result<Option<Box<dyn UpdateLock>>> {
        self.named_lock("update.lock")
    }

    fn apply_lock(&self) -> Result<Option<Box<dyn UpdateLock>>> {
        self.named_lock("update-apply.lock")
    }

    fn state(&self) -> Result<State> {
        self.read_state()
    }

    fn versions(&self) -> Result<Vec<String>> {
        self.complete_versions()
    }

    fn rejected(&self, version: &str) -> Result<bool> {
        self.root
            .join("rejected")
            .join(version)
            .try_exists()
            .internal()
    }

    fn version_path(&self, version: &str) -> PathBuf {
        self.root.join("versions").join(version)
    }

    fn prepare(&self, version: &str) -> Result<()> {
        self.prepare_version(version)
    }

    fn has_part(&self, digest: &str) -> Result<bool> {
        self.part_path(digest)
            .join("complete")
            .try_exists()
            .internal()
    }

    fn unpack(&self, part: &Part, bytes: &[u8]) -> Result<()> {
        self.unpack_part(part, bytes)
    }

    fn complete(&self, version: &str, parts: &PartsList) -> Result<()> {
        self.finish_version(version, parts)
    }

    fn transition(&self, state: &State) -> Result<()> {
        self.write_state(state)
    }

    fn reject(&self, version: &str) -> Result<()> {
        let rejected = self.root.join("rejected");
        fs::create_dir_all(&rejected).internal()?;
        fs::write(rejected.join(version), []).internal()
    }

    fn collect(&self, keep: &[String]) -> Result<()> {
        self.collect_unused(keep)
    }
}
