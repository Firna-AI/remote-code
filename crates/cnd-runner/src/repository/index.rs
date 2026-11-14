//! Temporary indexes and object stores leave the repository's Git storage unchanged.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use super::entries::{GitEntry, index_entries, path_input, tree_entries, zero_paths};
use super::error::{ErrorResultExt, Result};
use super::git::GitRequest;
use super::io::{IndexDirectory, PathKind};
use super::paths::{EntryState, GitPathClassifier, GitPaths, PathState};
use super::service::GitRepository;

pub(super) struct TemporaryIndex {
    pub directory: IndexDirectory,
    pub environment: BTreeMap<String, String>,
    pub paths: Vec<String>,
    pub untracked: Vec<String>,
    pub unavailable: Vec<String>,
    pub states: BTreeMap<String, PathState>,
    pub classifier: Box<dyn GitPaths>,
}

impl TemporaryIndex {
    pub(super) fn request(&self, repository: &GitRepository, args: &[&str]) -> GitRequest {
        let mut request = repository.request(args);
        request.environment = self.environment.clone();
        request
    }
}

impl GitRepository {
    pub(super) async fn index_run(&self, index: &TemporaryIndex, args: &[&str]) -> Result<Vec<u8>> {
        self.runner.run(index.request(self, args)).await
    }

    pub(super) async fn entries(&self, index: &TemporaryIndex) -> Result<Vec<GitEntry>> {
        index_entries(
            &self
                .index_run(index, &["ls-files", "--stage", "-z"])
                .await?,
        )
    }

    pub(super) async fn index(&self, base: Option<&str>) -> Result<TemporaryIndex> {
        let original = self
            .run(&["rev-parse", "--path-format=absolute", "--git-path", "index"])
            .await?;
        let objects = self
            .run(&[
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                "objects",
            ])
            .await?;
        let directory = self
            .io
            .temporary_index(PathBuf::from(
                String::from_utf8_lossy(&original).trim_end_matches('\n'),
            ))
            .await?;
        let environment = BTreeMap::from([
            (
                "GIT_INDEX_FILE".into(),
                directory
                    .path()
                    .join("index")
                    .to_string_lossy()
                    .into_owned(),
            ),
            (
                "GIT_OBJECT_DIRECTORY".into(),
                directory
                    .path()
                    .join("objects")
                    .to_string_lossy()
                    .into_owned(),
            ),
            (
                "GIT_ALTERNATE_OBJECT_DIRECTORIES".into(),
                serde_json::to_string(String::from_utf8_lossy(&objects).trim_end_matches('\n'))
                    .internal()?,
            ),
        ]);
        let mut index = TemporaryIndex {
            directory,
            environment,
            paths: vec![],
            untracked: vec![],
            unavailable: vec![],
            states: BTreeMap::new(),
            classifier: Box::new(GitPathClassifier::new(
                self.root.clone(),
                self.io.clone(),
                BTreeSet::new(),
                BTreeSet::new(),
            )),
        };
        if self.io.kind(index.directory.path().join("index")).await? == PathKind::Absent {
            self.index_run(&index, &["read-tree", "--empty"]).await?;
        }
        self.index_run(&index, &["update-index", "--no-split-index"])
            .await?;
        let tracked = self.entries(&index).await?;
        if !tracked.is_empty() {
            let mut request = index.request(self, &["update-index", "-z", "--index-info"]);
            request.input = tracked
                .iter()
                .flat_map(|entry| {
                    format!(
                        "{} {} {}\t{}\0",
                        entry.mode, entry.oid, entry.stage, entry.path
                    )
                    .into_bytes()
                })
                .collect();
            self.runner.run(request).await?;
        }
        let untracked = zero_paths(
            &self
                .run(&["ls-files", "--others", "--exclude-standard", "-z"])
                .await?,
        );
        let base_entries = match base {
            Some(sha) => tree_entries(&self.run(&["ls-tree", "-r", "-z", sha]).await?),
            None => vec![],
        };
        index.classifier = Box::new(GitPathClassifier::new(
            self.root.clone(),
            self.io.clone(),
            base_entries
                .iter()
                .chain(&tracked)
                .map(|entry| entry.path.clone())
                .collect(),
            tracked
                .iter()
                .filter(|entry| entry.mode == "160000")
                .map(|entry| entry.path.clone())
                .collect(),
        ));
        let candidates: BTreeSet<_> = tracked
            .iter()
            .map(|entry| entry.path.clone())
            .chain(untracked.iter().cloned())
            .chain(base_entries.iter().map(|entry| entry.path.clone()))
            .collect();
        let mut removed = Vec::new();
        for path in candidates {
            self.cancellation.check()?;
            let state = index.classifier.classify(&path).await?;
            match state.entry {
                EntryState::Present => index.paths.push(path.clone()),
                EntryState::Unavailable => {
                    index.unavailable.push(path.clone());
                    removed.push(path.clone());
                }
                EntryState::Absent => removed.push(path.clone()),
            }
            index.states.insert(path, state);
        }
        if !removed.is_empty() {
            let mut request =
                index.request(self, &["update-index", "--force-remove", "-z", "--stdin"]);
            request.input = path_input(&removed);
            self.runner.run(request).await?;
        }
        let supported: BTreeSet<_> = index.paths.iter().collect();
        index.untracked = untracked
            .into_iter()
            .filter(|path| supported.contains(path))
            .collect();
        Ok(index)
    }

    pub(super) async fn update_index(
        &self,
        index: &TemporaryIndex,
        paths: &[String],
    ) -> Result<()> {
        if !paths.is_empty() {
            let mut request = index.request(
                self,
                &[
                    "update-index",
                    "--add",
                    "--remove",
                    "--info-only",
                    "-z",
                    "--stdin",
                ],
            );
            request.input = path_input(paths);
            self.runner.run(request).await?;
        }
        Ok(())
    }

    pub(super) async fn comparison(
        &self,
        index: &TemporaryIndex,
        sha: &str,
        format: &str,
    ) -> Result<Vec<u8>> {
        let mut request = index.request(
            self,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--find-renames",
                "-z",
                format,
                sha,
                "--",
            ],
        );
        if !index.unavailable.is_empty() {
            request.literal_paths = false;
            request.args.push(".".into());
            request.args.extend(
                index
                    .unavailable
                    .iter()
                    .map(|path| format!(":(exclude,literal){path}")),
            );
        }
        let mut bytes = self.runner.run(request).await?;
        if !index.unavailable.is_empty() {
            let mut request = index.request(
                self,
                &[
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--find-renames",
                    "-z",
                    format,
                    "--cached",
                    sha,
                    "--",
                ],
            );
            request.args.extend(index.unavailable.iter().cloned());
            bytes.extend(self.runner.run(request).await?);
        }
        Ok(bytes)
    }
}
