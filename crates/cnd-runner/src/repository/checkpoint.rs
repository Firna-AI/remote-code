//! Git checkpoints include modes, conflict stages, filters, and recursive submodule work.

use std::collections::{BTreeMap, BTreeSet};

use cnd_runner_interface::file_changes::{ChangeKind, ChangedFile};
use sha2::{Digest, Sha256};

use super::error::{ErrorResultExt, Result};
use super::index::TemporaryIndex;
use super::service::{Checkpoint, GitRepository, Repository};

impl GitRepository {
    pub(super) async fn index_checkpoint(&self, index: &TemporaryIndex) -> Result<Checkpoint> {
        self.update_index(index, &index.paths).await?;
        let mut identities = BTreeMap::new();
        for entry in self.entries(index).await? {
            let mut identity = format!("{} {} {}", entry.mode, entry.oid, entry.stage);
            if entry.mode == "160000" {
                let child = Self {
                    root: self.root.join(&entry.path),
                    ..self.clone()
                };
                if let Ok(top) = child.run(&["rev-parse", "--show-toplevel"]).await
                    && String::from_utf8_lossy(&top).trim_end_matches('\n')
                        == child.root.to_string_lossy()
                {
                    match Box::pin(child.checkpoint()).await {
                        Ok(files) => {
                            identity.push(' ');
                            let records: Vec<_> = files.iter().collect();
                            let digest = Sha256::digest(serde_json::to_vec(&records).internal()?);
                            identity.push_str(
                                &digest
                                    .iter()
                                    .map(|byte| format!("{byte:02x}"))
                                    .collect::<String>(),
                            );
                        }
                        Err(_) => self.cancellation.check()?,
                    }
                }
                self.cancellation.check()?;
            }
            let value = identities.entry(entry.path).or_insert_with(String::new);
            value.push_str(&identity);
            value.push('\n');
        }
        Ok(identities)
    }

    pub(super) async fn compare_checkpoint(
        &self,
        branch: String,
        before: Checkpoint,
    ) -> Result<Vec<ChangedFile>> {
        let after = self.checkpoint().await?;
        let changes = self.changes(branch).await?;
        let mut identities = BTreeMap::new();
        for file in &changes.files {
            identities.insert(file.changed_file.path.clone(), &file.changed_file);
        }
        for file in &changes.files {
            if file.changed_file.change == ChangeKind::Renamed
                && let Some(previous) = &file.changed_file.previous_path
            {
                identities
                    .entry(previous.clone())
                    .or_insert(&file.changed_file);
            }
        }
        let paths: Vec<_> = before
            .keys()
            .chain(after.keys().filter(|path| !before.contains_key(*path)))
            .collect();
        let mut emitted = BTreeSet::new();
        let mut result = vec![];
        for path in paths {
            if before.get(path) == after.get(path) {
                continue;
            }
            if let Some(file) = identities.get(path) {
                if emitted.insert(&file.path) {
                    result.push((*file).clone());
                }
            } else {
                result.push(ChangedFile {
                    path: path.clone(),
                    display_path: None,
                    previous_path: None,
                    previous_display_path: None,
                    change: if !after.contains_key(path) {
                        ChangeKind::Deleted
                    } else if !before.contains_key(path) {
                        ChangeKind::Added
                    } else {
                        ChangeKind::Modified
                    },
                    added: 0,
                    removed: 0,
                });
            }
        }
        Ok(result)
    }
}
