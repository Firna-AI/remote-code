//! Atomic link changes, pending-start journal, and release collection.

use std::collections::HashSet;
use std::fs;

use cnd_release::parts::PartsList;
use cnd_release::version::release_version;

use super::disk::DiskStore;
use super::error::{ErrorResultExt, Result};
use super::ports::{State, Store};

impl DiskStore {
    pub(super) fn read_state(&self) -> Result<State> {
        let mut state = State {
            current: self.read_link("current")?,
            previous: self.read_link("previous")?,
            pending: None,
        };
        match fs::read(self.root.join("pending")) {
            Ok(bytes) => {
                let journal: State = serde_json::from_slice(&bytes).internal()?;
                state.previous = journal.previous;
                state.pending = journal.pending;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error).internal(),
        }
        Ok(state)
    }

    pub(super) fn complete_versions(&self) -> Result<Vec<String>> {
        let folder = self.root.join("versions");
        if !folder.try_exists().internal()? {
            return Ok(Vec::new());
        }
        let mut versions = Vec::new();
        for entry in fs::read_dir(folder).internal()? {
            let entry = entry.internal()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if release_version(&name).is_ok()
                && entry.path().join("complete").try_exists().internal()?
                && !self.rejected(&name)?
            {
                versions.push(name);
            }
        }
        Ok(versions)
    }

    pub(super) fn write_state(&self, state: &State) -> Result<()> {
        if state.pending.is_some() {
            fs::write(
                self.root.join("pending.next"),
                serde_json::to_vec(state).internal()?,
            )
            .internal()?;
            fs::rename(self.root.join("pending.next"), self.root.join("pending")).internal()?;
        }
        self.link(
            "previous",
            state
                .previous
                .as_ref()
                .map(|v| self.version_path(v))
                .as_deref(),
        )?;
        self.link(
            "current",
            state
                .current
                .as_ref()
                .map(|v| self.version_path(v))
                .as_deref(),
        )?;
        if state.pending.is_none() {
            self.remove(&self.root.join("pending"))?;
        }
        Ok(())
    }

    pub(super) fn collect_unused(&self, versions: &[String]) -> Result<()> {
        let keep: HashSet<_> = versions.iter().cloned().collect();
        let mut digests = HashSet::new();
        for version in &keep {
            let parts: PartsList = serde_json::from_slice(
                &fs::read(self.version_path(version).join("parts.json")).internal()?,
            )
            .internal()?;
            digests.extend(
                parts
                    .parts
                    .into_iter()
                    .map(|part| part.sha256.to_ascii_lowercase()),
            );
        }
        for entry in fs::read_dir(self.root.join("versions")).internal()? {
            let entry = entry.internal()?;
            if !keep.contains(&entry.file_name().to_string_lossy().into_owned()) {
                fs::remove_dir_all(entry.path()).internal()?;
            }
        }
        let parts = self.root.join("parts");
        if parts.try_exists().internal()? {
            for entry in fs::read_dir(parts).internal()? {
                let entry = entry.internal()?;
                if !digests.contains(&entry.file_name().to_string_lossy().into_owned()) {
                    fs::remove_dir_all(entry.path()).internal()?;
                }
            }
        }
        Ok(())
    }
}
