//! Capture Git marks, content identities, and ignored context entries once per scan.

use std::collections::BTreeMap;
use std::path::Path;

use cnd_runner_interface::file_tree::{FileEntry, FileEntryKind};

use super::context::path_order;
use super::error::Result;
use super::index::TemporaryIndex;
use super::io::PathKind;
use super::paths::PathState;
use super::service::{GitRepository, RepositorySnapshot};

fn entry(path: &str, state: PathState) -> FileEntry {
    FileEntry {
        path: path.into(),
        display_path: None,
        name: path
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .into(),
        kind: if state.kind == PathKind::Directory {
            FileEntryKind::Directory
        } else {
            FileEntryKind::File
        },
        change: None,
    }
}

impl GitRepository {
    async fn add_entry(
        &self,
        index: &mut TemporaryIndex,
        entries: &mut BTreeMap<String, FileEntry>,
        path: &str,
        state: PathState,
    ) -> Result<()> {
        if state.kind == PathKind::Absent {
            return Ok(());
        }
        entries.insert(path.into(), entry(path, state));
        let mut current = Path::new(path).parent();
        while let Some(parent) = current.filter(|parent| !parent.as_os_str().is_empty()) {
            let path = parent.to_string_lossy();
            let state = index.classifier.classify(&path).await?;
            if state.kind != PathKind::Directory {
                break;
            }
            entries.insert(path.to_string(), entry(&path, state));
            current = parent.parent();
        }
        Ok(())
    }

    pub(super) async fn capture(&self, branch: &str) -> Result<RepositorySnapshot> {
        let (branch, sha) = self.comparison_base(branch).await?;
        let mut index = self.index(Some(&sha)).await?;
        let changes = self.index_changes(&mut index, &branch, &sha).await?;
        let mut entries = BTreeMap::new();
        for (path, state) in index.states.clone() {
            self.add_entry(&mut index, &mut entries, &path, state)
                .await?;
        }
        for path in self.context_files(&mut index).await? {
            let state = index.classifier.classify(&path).await?;
            self.add_entry(&mut index, &mut entries, &path, state)
                .await?;
        }
        for file in &changes.files {
            if let Some(entry) = entries.get_mut(&file.changed_file.path)
                && (entry.kind != FileEntryKind::Directory
                    || index
                        .states
                        .get(&entry.path)
                        .is_some_and(|state| state.submodule))
            {
                entry.change = Some(file.changed_file.change.clone());
            }
        }
        let mut read_identities = BTreeMap::new();
        for entry in entries
            .values()
            .filter(|entry| entry.kind == FileEntryKind::File)
        {
            self.cancellation.check()?;
            read_identities.insert(
                entry.path.clone(),
                self.io
                    .identity(self.root.clone(), entry.path.clone())
                    .await?,
            );
        }
        let identities = self.index_checkpoint(&index).await?;
        let mut entries: Vec<_> = entries.into_values().collect();
        let order = path_order()?;
        entries.sort_by(|a, b| order.compare(&a.path, &b.path));
        Ok(RepositorySnapshot {
            entries,
            changes,
            identities,
            read_identities,
            base_commit: sha,
        })
    }
}
