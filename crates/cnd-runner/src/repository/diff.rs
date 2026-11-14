//! Bounded file-version reads and one-entry Git patches preserve representations.

use cnd_runner_interface::files::{DiffResponse, FILE_READ_MAX_BYTES};

use super::access::{safe_path, text};
use super::entries::{GitEntry, tree_entries};
use super::error::{Error, ErrorResultExt, Result};
use super::index::TemporaryIndex;
use super::io::PathKind;
use super::paths::EntryState;
use super::service::GitRepository;

impl GitRepository {
    async fn blob(
        &self,
        index: &TemporaryIndex,
        entry: Option<&GitEntry>,
    ) -> Result<Option<Vec<u8>>> {
        let Some(entry) = entry else {
            return Ok(None);
        };
        if entry.mode == "160000" {
            return Ok(Some(
                format!("Subproject commit {}\n", entry.oid).into_bytes(),
            ));
        }
        let size = self
            .index_run(index, &["cat-file", "-s", &entry.oid])
            .await?;
        let size = String::from_utf8_lossy(&size)
            .trim()
            .parse::<u64>()
            .internal()?;
        if size > FILE_READ_MAX_BYTES {
            return Err(Error::TooLarge {
                size,
                limit: FILE_READ_MAX_BYTES,
            });
        }
        let mut request = index.request(self, &["cat-file", "blob", &entry.oid]);
        request.max_bytes = Some(FILE_READ_MAX_BYTES);
        Ok(Some(self.runner.run(request).await?))
    }

    async fn entry_tree(&self, index: &TemporaryIndex, entry: Option<&GitEntry>) -> Result<String> {
        let mut request = index.request(self, &["mktree", "-z", "--missing"]);
        let Some(entry) = entry else {
            return Ok(String::from_utf8_lossy(&self.runner.run(request).await?)
                .trim()
                .into());
        };
        let mut mode = entry.mode.clone();
        let mut kind = if mode == "160000" { "commit" } else { "blob" };
        let mut oid = entry.oid.clone();
        for name in entry.path.split('/').rev() {
            request.input = format!("{mode} {kind} {oid}\t{name}\0").into_bytes();
            oid = String::from_utf8_lossy(&self.runner.run(request.clone()).await?)
                .trim()
                .into();
            mode = "040000".into();
            kind = "tree";
        }
        Ok(oid)
    }

    async fn patch(
        &self,
        index: &TemporaryIndex,
        previous: Option<&GitEntry>,
        current: Option<&GitEntry>,
    ) -> Result<Vec<u8>> {
        let old_tree = self.entry_tree(index, previous).await?;
        self.index_run(index, &["read-tree", "--empty"]).await?;
        if let Some(entry) = current {
            self.index_run(
                index,
                &[
                    "update-index",
                    "--add",
                    "--cacheinfo",
                    &format!("{},{},{}", entry.mode, entry.oid, entry.path),
                ],
            )
            .await?;
        }
        let mut args = vec!["diff"];
        if current.is_none_or(|entry| entry.mode != "160000") {
            args.push("--cached");
        }
        args.extend([
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--find-renames",
            "--submodule=short",
            &old_tree,
            "--",
        ]);
        if let Some(entry) = previous {
            args.push(&entry.path);
        }
        if let Some(entry) = current
            && previous.is_none_or(|old| old.path != entry.path)
        {
            args.push(&entry.path);
        }
        let mut request = index.request(self, &args);
        request.max_bytes = Some(FILE_READ_MAX_BYTES);
        self.runner.run(request).await
    }

    pub(super) async fn read_diff(&self, path: String, branch: &str) -> Result<DiffResponse> {
        safe_path(&path)?;
        let (branch, sha) = self.comparison_base(branch).await?;
        let mut index = self.index(Some(&sha)).await?;
        if index.unavailable.contains(&path) {
            return Err(Error::Unavailable);
        }
        let changes = self.index_changes(&mut index, &branch, &sha).await?;
        let old_path = changes
            .files
            .iter()
            .find(|file| file.changed_file.path == path)
            .and_then(|file| file.changed_file.previous_path.as_deref())
            .unwrap_or(&path);
        let previous = tree_entries(
            &self
                .index_run(&index, &["ls-tree", "-z", &sha, "--", old_path])
                .await?,
        )
        .into_iter()
        .find(|entry| entry.path == old_path);
        let previous_bytes = self.blob(&index, previous.as_ref()).await?;
        let physical = match index.states.get(&path) {
            Some(state) => *state,
            None => index.classifier.classify(&path).await?,
        };
        if physical.entry == EntryState::Unavailable {
            return Err(Error::Unavailable);
        }
        let bytes = match physical.kind {
            PathKind::Link => Some(self.io.link(self.root.clone(), path.clone()).await?),
            PathKind::File => Some(
                self.io
                    .read(self.root.clone(), path.clone(), FILE_READ_MAX_BYTES)
                    .await?,
            ),
            _ => None,
        };
        let paths: Vec<_> = index
            .paths
            .iter()
            .filter(|item| *item == &path || item.as_str() == old_path)
            .cloned()
            .collect();
        self.update_index(&index, &paths).await?;
        let mut current = self
            .entries(&index)
            .await?
            .into_iter()
            .find(|entry| entry.path == path && entry.stage == "0");
        if physical.kind == PathKind::Directory
            && physical.entry == EntryState::Present
            && current.as_ref().is_none_or(|entry| entry.mode != "160000")
        {
            return Err(Error::Unavailable);
        }
        if let Some(bytes) = bytes
            && let Some(entry) = current.as_mut()
            && entry.mode != "160000"
        {
            let filter = if entry.mode == "120000" {
                "--no-filters".into()
            } else {
                format!("--path={path}")
            };
            let mut request = index.request(self, &["hash-object", "-w", &filter, "--stdin"]);
            request.input = bytes;
            entry.oid = String::from_utf8_lossy(&self.runner.run(request).await?)
                .trim()
                .into();
            self.index_run(
                &index,
                &[
                    "update-index",
                    "--cacheinfo",
                    &format!("{},{},{}", entry.mode, entry.oid, path),
                ],
            )
            .await?;
        }
        let mut current_bytes = self.blob(&index, current.as_ref()).await?;
        if previous_bytes.is_none() && current_bytes.is_none() {
            return Err(Error::NotFound);
        }
        let patch = String::from_utf8_lossy(
            &self
                .patch(&index, previous.as_ref(), current.as_ref())
                .await?,
        )
        .into_owned();
        if let Some(entry) = current.as_ref()
            && entry.mode == "160000"
            && patch.contains(&format!("+Subproject commit {}-dirty", entry.oid))
        {
            current_bytes = Some(format!("Subproject commit {}-dirty\n", entry.oid).into_bytes());
        }
        let old_content = previous_bytes.as_deref().and_then(text);
        let new_content = current_bytes.as_deref().and_then(text);
        let binary = (previous_bytes.is_some() && old_content.is_none())
            || (current_bytes.is_some() && new_content.is_none());
        Ok(DiffResponse {
            path,
            display_path: None,
            base_branch: branch,
            display_base_branch: None,
            old_content,
            new_content,
            patch,
            binary,
        })
    }
}
