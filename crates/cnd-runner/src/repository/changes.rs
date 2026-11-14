//! Complete base-relative changes and independent raw-status and unpushed counts.

use std::collections::{BTreeMap, BTreeSet};

use cnd_runner_interface::file_changes::{
    BranchChangedFile, ChangeKind, ChangedFile, ChangesResponse, ChangesResponseSummary,
};

use super::context::path_order;
use super::entries::{path_input, zero_paths};
use super::error::{Error, ErrorResultExt, Result};
use super::index::TemporaryIndex;
use super::service::GitRepository;

fn counts(bytes: &[u8]) -> Result<BTreeMap<String, (u64, u64)>> {
    let records = zero_paths(bytes);
    let mut result = BTreeMap::new();
    let mut records = records.iter();
    while let Some(record) = records.next() {
        let mut fields = record.splitn(3, '\t');
        let added = fields.next().ok_or(Error::InvalidOutput)?;
        let removed = fields.next().ok_or(Error::InvalidOutput)?;
        let mut path = fields.next().ok_or(Error::InvalidOutput)?;
        if path.is_empty() {
            records.next().ok_or(Error::InvalidOutput)?;
            path = records.next().ok_or(Error::InvalidOutput)?;
        }
        result.insert(
            path.to_owned(),
            (added.parse().unwrap_or(0), removed.parse().unwrap_or(0)),
        );
    }
    Ok(result)
}

impl GitRepository {
    pub(super) async fn index_changes(
        &self,
        index: &mut TemporaryIndex,
        branch: &str,
        sha: &str,
    ) -> Result<ChangesResponse> {
        if !index.unavailable.is_empty() {
            tracing::warn!("Some repository files cannot be stored by Git.");
        }
        if !index.untracked.is_empty() {
            let mut request = index.request(
                self,
                &[
                    "add",
                    "--intent-to-add",
                    "--pathspec-from-file=-",
                    "--pathspec-file-nul",
                ],
            );
            request.input = path_input(&index.untracked);
            self.runner.run(request).await?;
        }
        let names = self.comparison(index, sha, "--name-status").await?;
        let numbers = counts(&self.comparison(index, sha, "--numstat").await?)?;
        let status = self
            .run(&["status", "--porcelain=v1", "-z", "--untracked-files=all"])
            .await?;
        let unpushed = self
            .run(&["rev-list", "--count", "HEAD", "--not", "--remotes"])
            .await?;
        let records = zero_paths(&status);
        let mut records = records.iter();
        let mut dirty = BTreeSet::new();
        let mut uncommitted_file_count = 0;
        while let Some(record) = records.next() {
            let status = record.get(..2).ok_or(Error::InvalidOutput)?;
            dirty.insert(record.get(3..).ok_or(Error::InvalidOutput)?.to_owned());
            uncommitted_file_count += 1;
            if status.contains(['R', 'C']) {
                dirty.insert(records.next().ok_or(Error::InvalidOutput)?.clone());
            }
        }
        let records = zero_paths(&names);
        let mut records = records.iter();
        let mut files = Vec::new();
        while let Some(status) = records.next() {
            let old = records.next().ok_or(Error::InvalidOutput)?;
            let renamed = status.starts_with(['R', 'C']);
            let path = if renamed {
                records.next().ok_or(Error::InvalidOutput)?
            } else {
                old
            };
            let change = match status.as_bytes().first() {
                Some(b'A') if index.untracked.contains(path) => ChangeKind::Untracked,
                Some(b'A') => ChangeKind::Added,
                Some(b'D') => ChangeKind::Deleted,
                Some(b'R') => ChangeKind::Renamed,
                _ => ChangeKind::Modified,
            };
            let (added, removed) = numbers.get(path).copied().unwrap_or_default();
            files.push(BranchChangedFile {
                changed_file: ChangedFile {
                    path: path.clone(),
                    display_path: None,
                    previous_path: renamed.then(|| old.clone()),
                    previous_display_path: None,
                    change,
                    added,
                    removed,
                },
                uncommitted: dirty.contains(path) || dirty.contains(old),
            });
        }
        let order = path_order()?;
        files.sort_by(|a, b| order.compare(&a.changed_file.path, &b.changed_file.path));
        let summary = ChangesResponseSummary {
            files: files.len() as u64,
            added: files.iter().map(|file| file.changed_file.added).sum(),
            removed: files.iter().map(|file| file.changed_file.removed).sum(),
        };
        Ok(ChangesResponse {
            base_branch: branch.into(),
            display_base_branch: None,
            unpushed_commits: Some(
                String::from_utf8_lossy(&unpushed)
                    .trim()
                    .parse()
                    .internal()?,
            ),
            uncommitted_file_count: Some(uncommitted_file_count),
            files,
            summary,
        })
    }
}
